import type { ComponentType } from 'react'
import Constants from 'expo-constants'
import { FEATURES } from '../lib/featureFlags'

interface Props {
  onError: (msg: string) => void
}

// ── SSO buttons gate ─────────────────────────────────────────────────────────
// When neither provider is enabled, render nothing AND skip the impl module
// entirely — `require()` is lazy in Metro, so the native SDK imports inside
// SsoButtonsImpl never run. This means an unconfigured build can ship without
// the OAuth packages installed or any client IDs set.
//
// We ALSO skip in Expo Go: `@react-native-google-signin/google-signin` is a
// native module that isn't bundled in Expo Go, so requiring SsoButtonsImpl
// would throw `'RNGoogleSignin' could not be found` at first render. Dev work
// in Expo Go falls back to email/password (which Expo Go supports natively).
// Real builds — development client, preview, production — render normally.

const isExpoGo = Constants.executionEnvironment === 'storeClient'

export default function SsoButtons(props: Props) {
  if (!FEATURES.anySso) return null
  if (isExpoGo) return null

  const Impl: ComponentType<Props> = require('./SsoButtonsImpl').default
  return <Impl {...props} />
}
