import type { ComponentType } from 'react'
import { FEATURES } from '../lib/featureFlags'

interface Props {
  onError: (msg: string) => void
}

// ── SSO buttons gate ─────────────────────────────────────────────────────────
// When neither provider is enabled, render nothing AND skip the impl module
// entirely — `require()` is lazy in Metro, so the native SDK imports inside
// SsoButtonsImpl never run. This means an unconfigured build can ship without
// the OAuth packages installed or any client IDs set.

export default function SsoButtons(props: Props) {
  if (!FEATURES.anySso) return null

  const Impl: ComponentType<Props> = require('./SsoButtonsImpl').default
  return <Impl {...props} />
}
