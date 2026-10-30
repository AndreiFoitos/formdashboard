import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

// The server works out "today" and every reminder time in the account's
// timezone, which defaulted to UTC because nothing ever sent the phone's.

/** The phone's IANA zone ("Europe/Bucharest"), or null if Intl can't say. */
export function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/** App start: save the phone's timezone to the account when it differs
 *  (first run, or after travelling). Fails quietly; retried next start. */
export async function syncTimezone(): Promise<void> {
  const tz = deviceTimezone()
  const user = useAuthStore.getState().user
  if (!tz || !user || user.timezone === tz) return
  try {
    await api.put('/users/me', { timezone: tz })
    const current = useAuthStore.getState().user
    if (current) useAuthStore.setState({ user: { ...current, timezone: tz } })
  } catch (e) {
    if (__DEV__) console.warn('[timezone] sync failed:', e)
  }
}
