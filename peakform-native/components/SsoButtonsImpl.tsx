import { useState } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import Svg, { Path } from 'react-native-svg'

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

// ── Multicolor Google "G" logo (official mark) ────────────────────────────────
// Vector traced from Google's identity guidelines. Sized to match the cap-height
// of Apple's "Continue with Apple" button glyph at the same row height.
function GoogleGLogo({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#FFC107"
        d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
      />
      <Path
        fill="#FF3D00"
        d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
      />
      <Path
        fill="#4CAF50"
        d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
      />
      <Path
        fill="#1976D2"
        d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
      />
    </Svg>
  )
}

// ── Apple + Google sign-in buttons (real implementation) ─────────────────────
// This file is only required at runtime when FEATURES.anySso is true (see
// ./SsoButtons.tsx). Keeping the native imports here means an unconfigured
// build never touches the SSO SDKs.
//
// Design choices:
// - Both buttons are 52pt tall with a 16pt corner radius — matches Apple's
//   recommended sizing exactly (Apple's button is the native control, Google's
//   is a hand-rolled match).
// - Apple uses its own white pill (mandated by Apple HIG — third-party styling
//   of "Sign in with Apple" gets the app rejected on submission).
// - Google uses the same white pill with the official multicolor G mark on
//   the left, "Continue with Google" centered in semibold text.

const BUTTON_HEIGHT = 52
const BUTTON_RADIUS = 16

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
            cornerRadius={BUTTON_RADIUS}
            style={{
              width: '100%',
              height: BUTTON_HEIGHT,
              opacity: appleBusy ? 0.5 : 1,
            }}
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
          activeOpacity={0.85}
          style={{
            height: BUTTON_HEIGHT,
            borderRadius: BUTTON_RADIUS,
            backgroundColor: 'white',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: googleBusy ? 0.5 : 1,
            paddingHorizontal: 16,
          }}
        >
          {googleBusy ? (
            <ActivityIndicator color="black" />
          ) : (
            <>
              <View style={{ marginRight: 10 }}>
                <GoogleGLogo size={20} />
              </View>
              <Text
                style={{
                  color: 'black',
                  fontSize: 17,
                  fontWeight: '600',
                  letterSpacing: -0.2,
                }}
              >
                Continue with Google
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  )
}
