import { Platform } from 'react-native'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import { api } from '../api/client'
import { router } from 'expo-router'
import { colors } from '../theme/tokens'
import { getToken, removeToken, setToken } from './storage'

// Same lazy-load pattern as healthkit.ts: importing expo-notifications at the
// top level is fine, but `getExpoPushTokenAsync` no longer works in Expo Go
// (SDK 53+) — needs a dev build. We guard around that so the dev experience
// stays clean in Expo Go.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient

// Categories must match the backend constants in services/notifier.py.
export const CATEGORY_HYDRATION = 'quick_log_hydration'
export const CATEGORY_STIMULANT = 'quick_log_stimulant'

let _categoriesRegistered = false
let _handlerRegistered = false

async function loadNotifs() {
  return await import('expo-notifications')
}

export function canRegisterPushToken(): boolean {
  return !isExpoGo
}

/** Idempotent — safe to call on every app open. */
export async function setupNotificationHandlers(): Promise<void> {
  const Notifications = await loadNotifs()
  if (!_handlerRegistered) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    })
    _handlerRegistered = true
  }
  if (!_categoriesRegistered) {
    await Notifications.setNotificationCategoryAsync(CATEGORY_HYDRATION, [
      {
        identifier: 'LOG_NOW',
        buttonTitle: 'Log it',
        options: {
          // Opens the app briefly to run the response handler. Switching this
          // to false (fully headless) is a follow-up — needs the background
          // notification entitlement on iOS and works less reliably across OS
          // versions, so we get the loop working with foreground first.
          opensAppToForeground: true,
        },
      },
      { identifier: 'DISMISS', buttonTitle: 'Skip', options: { opensAppToForeground: false } },
    ])
    await Notifications.setNotificationCategoryAsync(CATEGORY_STIMULANT, [
      { identifier: 'LOG_NOW', buttonTitle: 'Log it', options: { opensAppToForeground: true } },
      { identifier: 'DISMISS', buttonTitle: 'Skip', options: { opensAppToForeground: false } },
    ])
    _categoriesRegistered = true
  }
}

/** Returns true if permission was newly or already granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  const Notifications = await loadNotifs()
  const existing = await Notifications.getPermissionsAsync()
  if (existing.granted) return true
  if (existing.canAskAgain === false) return false
  const result = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  })
  return result.granted
}

/** Registers the device's Expo push token with the backend. */
export async function registerPushTokenWithBackend(): Promise<{ token: string } | null> {
  if (!canRegisterPushToken()) return null
  const Notifications = await loadNotifs()

  // Android requires an explicit channel for push to land at all.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200, 200, 200],
      lightColor: colors.text,
    })
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants.easConfig as { projectId?: string } | undefined)?.projectId
  if (!projectId) {
    if (__DEV__) console.warn('[notifications] No EAS projectId — cannot fetch push token')
    return null
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
  await api.post('/notifications/register-token', {
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  })
  return { token }
}

const NUDGES_OFF_KEY = 'nudges_off'

/** True after the user switched Smart nudges off in Settings. */
export async function nudgesOptedOut(): Promise<boolean> {
  try {
    return (await getToken(NUDGES_OFF_KEY)) === '1'
  } catch {
    return false
  }
}

/** Cheap read for the Settings toggle. Doesn't prompt. */
export async function getNudgeStatus(): Promise<{
  granted: boolean
  canAskAgain: boolean
}> {
  try {
    const Notifications = await loadNotifs()
    const perm = await Notifications.getPermissionsAsync()
    return { granted: !!perm.granted, canAskAgain: perm.canAskAgain !== false }
  } catch {
    return { granted: false, canAskAgain: true }
  }
}

/**
 * Stop nudges: tells the backend to forget this device's push token. We
 * intentionally don't try to revoke the OS notification permission here — the
 * user can do that in OS settings if they want, and re-enabling later works
 * without another prompt.
 */
export async function disableNudges(): Promise<void> {
  // Remembered so app start doesn't re-register the token behind the user's back.
  await setToken(NUDGES_OFF_KEY, '1').catch(() => {})
  if (!canRegisterPushToken()) return
  try {
    const Notifications = await loadNotifs()
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants.easConfig as { projectId?: string } | undefined)?.projectId
    if (!projectId) return
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    await api.delete('/notifications/token', { params: { token } })
  } catch (e) {
    if (__DEV__) console.warn('[notifications] disable failed:', e)
  }
}

/** App start: register this phone's token if notifications are already
 *  allowed, without prompting. The prompt itself belongs where it can be
 *  explained (onboarding's last step, the Today card, Build my plan): iOS
 *  shows it only once, and a bare prompt at launch didn't reliably appear. */
export async function registerIfGranted(): Promise<void> {
  try {
    await setupNotificationHandlers()
    const Notifications = await loadNotifs()
    const perm = await Notifications.getPermissionsAsync()
    if (perm.granted && canRegisterPushToken() && !(await nudgesOptedOut())) await registerPushTokenWithBackend()
  } catch (e) {
    if (__DEV__) console.warn('[notifications] silent register failed:', e)
  }
}

/** Full enable flow — permission → token → backend register. Idempotent.
 *  On failure, `detail` carries the underlying error (it used to be
 *  swallowed, which is how no device ever registered without anyone
 *  noticing). */
export async function enablePredictiveNudges(): Promise<{ enabled: boolean; reason?: string; detail?: string }> {
  try {
    await setupNotificationHandlers()
    const granted = await requestNotificationPermission()
    if (!granted) return { enabled: false, reason: 'permission_denied' }
    await removeToken(NUDGES_OFF_KEY).catch(() => {})
    if (!canRegisterPushToken()) return { enabled: true, reason: 'expo_go_local_only' }
    const result = await registerPushTokenWithBackend()
    if (!result) return { enabled: false, reason: 'no_project_id' }
    return { enabled: true }
  } catch (e: any) {
    if (__DEV__) console.warn('[notifications] enable failed:', e)
    const status = e?.response?.status
    const detail = status
      ? `Server said ${status}: ${JSON.stringify(e.response.data?.detail ?? e.response.data)}`
      : String(e?.message ?? e)
    return { enabled: false, reason: 'error', detail }
  }
}

/** Read a quick-log payload from a notification response. */
export interface QuickLogPayload {
  action: 'quick_log'
  type: 'hydration' | 'stimulant'
  amount_ml?: number
  substance?: string
  caffeine_mg?: number
  slot_minute?: number
}

export function parseQuickLogPayload(data: unknown): QuickLogPayload | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.action !== 'quick_log') return null
  const type = d.type
  if (type !== 'hydration' && type !== 'stimulant') return null
  return {
    action: 'quick_log',
    type,
    amount_ml: typeof d.amount_ml === 'number' ? d.amount_ml : undefined,
    substance: typeof d.substance === 'string' ? d.substance : undefined,
    caffeine_mg: typeof d.caffeine_mg === 'number' ? d.caffeine_mg : undefined,
    slot_minute: typeof d.slot_minute === 'number' ? d.slot_minute : undefined,
  }
}

/**
 * Convert a notification response into a backend quick-log call.
 *
 * Uses the OS-issued notification request identifier as the idempotency key,
 * so a duplicate response delivery (rare but real on flaky connections) hits
 * the server-side Redis dedupe instead of double-logging.
 */
export async function handleQuickLogResponse(
  response: { notification: { request: { identifier: string; content: { data: unknown } } }; actionIdentifier: string },
  qc?: { invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown },
): Promise<void> {
  // The "Skip" action and the swipe-to-dismiss case don't need a backend call.
  if (response.actionIdentifier === 'DISMISS') return
  const payload = parseQuickLogPayload(response.notification.request.content.data)
  if (!payload) return

  const requestId = `notif-${response.notification.request.identifier}`
  try {
    await api.post('/logs/quick', {
      type: payload.type,
      request_id: requestId,
      amount_ml: payload.amount_ml,
      substance: payload.substance,
      caffeine_mg: payload.caffeine_mg,
    })
    if (qc) {
      // Match the keys used by hydration / stimulant screens so the UI updates
      // when the user opens the app after tapping.
      if (payload.type === 'hydration') {
        qc.invalidateQueries({ queryKey: ['hydration-today'] })
      } else {
        qc.invalidateQueries({ queryKey: ['stimulants-today'] })
        qc.invalidateQueries({ queryKey: ['caffeine-curve'] })
      }
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    }
  } catch (e) {
    if (__DEV__) console.warn('[notifications] quick-log failed:', e)
  }
}


/**
 * Pit Crew pushes: "Your plan is ready" (services/plan_builder.py) and the
 * Sunday "Your weekly check-in" (services/plan_checkin.py). Refresh the Pit
 * Crew queries and open the Pit tab.
 */
export function handlePlanReadyResponse(
  response: { notification: { request: { content: { data: unknown } } } },
  qc?: { invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown },
): boolean {
  const data = response.notification.request.content.data as Record<string, unknown> | null
  if (!data || (data.type !== 'plan_ready' && data.type !== 'checkin_ready')) return false
  qc?.invalidateQueries({ queryKey: ['plan-ai'] })
  router.navigate('/ask')
  return true
}
