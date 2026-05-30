import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { router } from 'expo-router'
import * as AppleAuthentication from 'expo-apple-authentication'
import {
  GoogleSignin,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin'

import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { setToken } from './storage'

// ── Google Sign-In configuration ─────────────────────────────────────────────
// Client IDs come from app.json -> extra.googleSignIn so they can differ per
// build profile. configure() is cheap and idempotent — call it once at module
// load so the first sign-in attempt isn't slow.

const extra = (Constants.expoConfig?.extra ?? {}) as {
  googleSignIn?: { iosClientId?: string; webClientId?: string }
}

let googleConfigured = false
function ensureGoogleConfigured() {
  if (googleConfigured) return
  GoogleSignin.configure({
    iosClientId: extra.googleSignIn?.iosClientId || undefined,
    webClientId: extra.googleSignIn?.webClientId || undefined,
  })
  googleConfigured = true
}

// ── Shared post-auth handler ─────────────────────────────────────────────────
// Both providers return access+refresh tokens from our backend. From there the
// flow is identical: persist refresh, fetch /users/me, push the user into the
// auth store, and route based on whether onboarding is done.

async function completeSignIn(tokens: { access_token: string; refresh_token: string }) {
  await setToken('refresh_token', tokens.refresh_token)

  const { data: user } = await api.get('/users/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  useAuthStore.getState().setAuth(user, tokens.access_token)
  router.replace(user.onboarding_complete ? '/' : '/onboarding')
}

// ── Apple ────────────────────────────────────────────────────────────────────

export function isAppleSignInSupported(): boolean {
  // The Apple button is iOS-only; the JS library no-ops on Android/web.
  return Platform.OS === 'ios'
}

export async function signInWithApple() {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  })

  if (!credential.identityToken) {
    throw new Error('Apple did not return an identity token')
  }

  // Apple only includes fullName on the very first sign-in. We forward it so
  // the backend can populate `name` for new accounts.
  const fullName =
    credential.fullName?.givenName || credential.fullName?.familyName
      ? [credential.fullName?.givenName, credential.fullName?.familyName]
          .filter(Boolean)
          .join(' ')
      : null

  const { data: tokens } = await api.post('/auth/apple', {
    identity_token: credential.identityToken,
    full_name: fullName,
  })

  await completeSignIn(tokens)
}

// ── Google ───────────────────────────────────────────────────────────────────

export async function signInWithGoogle() {
  ensureGoogleConfigured()

  // hasPlayServices is a no-op on iOS but required on Android before signIn().
  if (Platform.OS === 'android') {
    await GoogleSignin.hasPlayServices()
  }

  const response = await GoogleSignin.signIn()

  if (!isSuccessResponse(response)) {
    // User cancelled or auth failed — bubble up nothing so the caller can
    // distinguish "user closed the sheet" from a real error.
    return
  }

  const idToken = response.data.idToken
  if (!idToken) {
    throw new Error('Google did not return an ID token — check webClientId is set')
  }

  const { data: tokens } = await api.post('/auth/google', { id_token: idToken })
  await completeSignIn(tokens)
}
