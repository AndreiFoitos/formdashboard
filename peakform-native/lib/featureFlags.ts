import Constants from 'expo-constants'

// Runtime feature flags sourced from app.json -> extra.features.
// Default to OFF so half-finished features stay dark in unconfigured builds.

const extra = (Constants.expoConfig?.extra ?? {}) as {
  features?: { appleSignIn?: boolean; googleSignIn?: boolean }
}
const f = extra.features ?? {}

export const FEATURES = {
  appleSignIn: !!f.appleSignIn,
  googleSignIn: !!f.googleSignIn,
  // Convenience: true if either provider is enabled, so call sites can do a
  // single check before rendering the whole "or sign in with…" section.
  anySso: !!f.appleSignIn || !!f.googleSignIn,
} as const
