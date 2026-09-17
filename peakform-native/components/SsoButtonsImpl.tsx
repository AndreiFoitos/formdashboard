import { useState, type ReactNode } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native'
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
// Vector traced from Google's identity guidelines.
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

// ── Apple logo (black, for the white button) ─────────────────────────────────
function AppleLogo({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill="#000000"
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
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
// - Both buttons are rendered by the same SsoButton so the logo size, font,
//   weight and spacing are identical. The native AppleAuthenticationButton
//   draws its own title (size scales with height, Apple's weight), which never
//   lined up with a hand-rolled Google button.
// - The custom Apple button follows Apple's HIG rules for custom buttons:
//   Apple logo, "Continue with Apple" title, system font, title size ~43% of
//   button height, white background with black content.

const BUTTON_HEIGHT = 52
const BUTTON_RADIUS = 16
const TITLE_SIZE = 19
const LOGO_SIZE = 20

function SsoButton({
  title,
  logo,
  busy,
  onPress,
}: {
  title: string
  logo: ReactNode
  busy: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={{
        height: BUTTON_HEIGHT,
        borderRadius: BUTTON_RADIUS,
        backgroundColor: 'white',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: busy ? 0.5 : 1,
        paddingHorizontal: 16,
      }}
    >
      {busy ? (
        <ActivityIndicator color="black" />
      ) : (
        <>
          <View style={{ width: LOGO_SIZE, height: LOGO_SIZE, marginRight: 10 }}>{logo}</View>
          <Text style={{ color: 'black', fontSize: TITLE_SIZE, fontWeight: '500' }}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  )
}

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
        <SsoButton
          title="Continue with Apple"
          logo={<AppleLogo size={LOGO_SIZE} />}
          busy={appleBusy}
          onPress={onApple}
        />
      )}
      {showGoogle && (
        <SsoButton
          title="Continue with Google"
          logo={<GoogleGLogo size={LOGO_SIZE} />}
          busy={googleBusy}
          onPress={onGoogle}
        />
      )}
    </View>
  )
}
