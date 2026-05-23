import { useEffect } from 'react'
import { router } from 'expo-router'
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

  return { user, hydrated }
}