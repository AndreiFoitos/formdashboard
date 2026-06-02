import { useState } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'

import { FEATURES } from '../lib/featureFlags'
import { isAppleSignInSupported, signInWithApple, signInWithGoogle } from '../lib/sso'
import { extractErrorMessage } from '../lib/apiError'

interface Props {
  onError: (msg: string) => void
}

// Translate raw axios / native errors into a one-line message a user can act on.
// Order matters: the backend's 503 "not configured" trumps the generic detail.
function humanizeSsoError(err: any, provider: 'Apple' | 'Google'): string {
  const status = err?.response?.status

  if (status === 503) {
    return `${provider} sign-in isn't set up on the server yet. Try email or the other provider.`
  }
  if (status === 401) {
    return `${provider} rejected the sign-in. Try again, or use email.`
  }
  if (!err?.response && err?.message?.includes?.('Network')) {
    return "Can't reach the server. Check your connection and try again."
  }
  return extractErrorMessage(err, `${provider} sign-in failed`)
}

// ── Apple + Google sign-in buttons (real implementation) ─────────────────────
// This file is only required at runtime when FEATURES.anySso is true (see
// ./SsoButtons.tsx). Keeping the native imports here means an unconfigured
// build never touches the SSO SDKs.

export default function SsoButtonsImpl({ onError }: Props) {
  const [appleBusy, setAppleBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)

  async function onApple() {
    setAppleBusy(true)
    try {
      await signInWithApple()
    } catch (err: any) {
      // The native dialog throws ERR_REQUEST_CANCELED on user dismiss.
      if (err?.code === 'ERR_REQUEST_CANCELED') return
      onError(humanizeSsoError(err, 'Apple'))
    } finally {
      setAppleBusy(false)
    }
  }

  async function onGoogle() {
    setGoogleBusy(true)
    try {
      await signInWithGoogle()
    } catch (err: any) {
      // SIGN_IN_CANCELLED = user closed the sheet; ignore quietly.
      if (err?.code === '-5' || err?.code === 'SIGN_IN_CANCELLED') return
      onError(humanizeSsoError(err, 'Google'))
    } finally {
      setGoogleBusy(false)
    }
  }

  const showApple = FEATURES.appleSignIn && isAppleSignInSupported()
  const showGoogle = FEATURES.googleSignIn

  return (
    <View style={{ gap: 10 }}>
      {showApple && (
        <View style={{ position: 'relative' }}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={16}
            style={{ width: '100%', height: 50, opacity: appleBusy ? 0.5 : 1 }}
            onPress={onApple}
          />
          {appleBusy && (
            <View className="absolute inset-0 items-center justify-center">
              <ActivityIndicator color="black" />
            </View>
          )}
        </View>
      )}

      {showGoogle && (
        <TouchableOpacity
          onPress={onGoogle}
          disabled={googleBusy}
          className="flex-row items-center justify-center bg-white rounded-2xl py-3.5"
          style={{ opacity: googleBusy ? 0.5 : 1, height: 50 }}
        >
          {googleBusy ? (
            <ActivityIndicator color="black" />
          ) : (
            <>
              <Text style={{ fontSize: 16, marginRight: 8 }}>G</Text>
              <Text className="text-black font-semibold text-base">
                Continue with Google
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  )
}
