import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'

// Native side: ios/WidgetBridgeModule.swift. Android is a no-op stub until
// phase 4 (docs/widgets-design.md §7).
//
// Optional on purpose: Expo Go, web and builds made before this module existed
// have no native side, and every call then does nothing. The widget must never
// crash or block the app.

interface WidgetBridgeNative {
  setSnapshot(json: string): boolean
  getSnapshot(): string | null
  clearSnapshot(): void
  reloadWidgets(): void
  setWidgetToken(token: string | null): void
}

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<WidgetBridgeNative>('WidgetBridge') : null

/** True when the native module is in this binary (iOS dev client / store build). */
export const isAvailable = native != null

/** Writes the snapshot JSON to the App Group (key `widget.snapshot.v1`). */
export function setSnapshot(json: string): boolean {
  try {
    return native?.setSnapshot(json) ?? false
  } catch {
    return false
  }
}

/** The snapshot the widgets currently read, or null. For the dev screen. */
export function getSnapshot(): string | null {
  try {
    return native?.getSnapshot() ?? null
  } catch {
    return null
  }
}

/** Removes the snapshot, so widgets show "Open GainRace to set up". */
export function clearSnapshot(): void {
  try {
    native?.clearSnapshot()
  } catch {
    // Nothing to clear.
  }
}

/** Asks WidgetKit to rebuild every widget timeline. */
export function reloadWidgets(): void {
  try {
    native?.reloadWidgets()
  } catch {
    // WidgetKit unavailable; the next scheduled timeline picks it up.
  }
}

/** Phase 3: stores the scoped widget token in the shared keychain group.
 *  No-op in phase 1. */
export function setWidgetToken(token: string | null): void {
  try {
    native?.setWidgetToken(token)
  } catch {
    // Phase 3.
  }
}
