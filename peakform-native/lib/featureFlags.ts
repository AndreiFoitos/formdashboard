import Constants from 'expo-constants'

// Runtime feature flags sourced from app.json -> extra.features.
// Half-finished features default to OFF so they stay dark in unconfigured
// builds. Shipped features default to ON, so a missing key can never silently
// strip something the App Store build is supposed to have.

const extra = (Constants.expoConfig?.extra ?? {}) as {
  features?: {
    appleSignIn?: boolean
    googleSignIn?: boolean
    avatar?: boolean
    avatarDevTools?: boolean
  }
}
const f = extra.features ?? {}

export const FEATURES = {
  appleSignIn: !!f.appleSignIn,
  googleSignIn: !!f.googleSignIn,
  // Convenience: true if either provider is enabled, so call sites can do a
  // single check before rendering the whole "or sign in with…" section.
  anySso: !!f.appleSignIn || !!f.googleSignIn,
  // The 3D avatar feature: the live preview in onboarding, the dashboard
  // badge, the unlock modal, the recap podium, and Settings → Edit avatar.
  // This is a SHIPPING feature and a kill switch only — it stays on unless
  // something is explicitly set to false. It was previously called
  // `avatarLab`, which made it look internal and nearly got the whole feature
  // switched off before submission.
  avatar: f.avatar !== false,
  // Internal instrumentation only: Settings → Avatar lab (placeholder-model
  // toggle, FPS counter, snapshot timing). Ships OFF; flip it on in app.json
  // when you need to profile the renderer.
  avatarDevTools: !!f.avatarDevTools,
} as const
