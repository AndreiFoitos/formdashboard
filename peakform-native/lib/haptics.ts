import * as Haptics from 'expo-haptics'

// Thin wrappers around expo-haptics so call sites read intent, not API.
// All are fire-and-forget; failures (e.g. web, unsupported device) are ignored.

export function hapticSelection() {
  Haptics.selectionAsync().catch(() => {})
}

export function hapticLight() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
}

export function hapticMedium() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
}

export function hapticSuccess() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
}

export function hapticWarning() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
}
