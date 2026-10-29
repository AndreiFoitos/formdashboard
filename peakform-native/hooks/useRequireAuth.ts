import { useCallback, useEffect } from 'react'
import { router, useFocusEffect } from 'expo-router'
import { useAuthStore } from '../store/auth'

/**
 * Call this at the top of any screen that requires authentication.
 * If the user is not logged in it redirects to /login immediately.
 *
 * Usage:
 *   export default function DashboardScreen() {
 *     useRequireAuth()
 *     ...
 *   }
 */
export function useRequireAuth() {
  const { user, hydrated } = useAuthStore()

  useEffect(() => {
    if (!hydrated) return // still loading — wait
    if (!user) {
      router.replace('/login')
    }
  }, [user, hydrated])

  // After sign out the tabs stay mounted under /login. A deep link (widget
  // tap, notification) that brings one back into focus doesn't change auth
  // state, so the effect above wouldn't run again; check on every focus.
  useFocusEffect(
    useCallback(() => {
      const { user: current, hydrated: ready } = useAuthStore.getState()
      if (ready && !current) router.replace('/login')
    }, []),
  )

  return { user, hydrated }
}
