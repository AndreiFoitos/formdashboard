import '../global.css'
import { useEffect, useRef } from 'react'
import { Stack, router } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useAuthStore } from '../store/auth'
import { getToken } from '../lib/storage'
import { api } from '../api/client'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 min — same as web
      retry: 1,
    },
  },
})

// ── Auth hydration ────────────────────────────────────────────────────────────
// On app start we check SecureStore for a saved refresh token and, if found,
// silently exchange it for a fresh access token. This keeps users logged in
// across app restarts without storing the access token (which is short-lived).
function AuthGate({ children }: { children: React.ReactNode }) {
  const { setAuth, setHydrated, hydrated, user } = useAuthStore()
  const qc = useQueryClient()
  const lastUserId = useRef<string | null>(null)

  // Wipe React Query cache whenever the signed-in user changes.
  // Query keys like ['ai-digest'] / ['dashboard'] don't include user_id,
  // so without this, data from account A leaks to account B on resignin.
  useEffect(() => {
    const currentId = user?.id ?? null
    if (lastUserId.current !== null && lastUserId.current !== currentId) {
      qc.clear()
    }
    lastUserId.current = currentId
  }, [user?.id, qc])

  useEffect(() => {
    async function hydrate() {
      try {
        const { getToken: _getToken } = await import('../lib/storage')
        const refreshToken = await _getToken('refresh_token')

        if (!refreshToken) {
          setHydrated(true)
          return
        }

        // Exchange the stored refresh token for a fresh access token
        const { data: tokens } = await api.post('/auth/refresh', {
          refresh_token: refreshToken,
        })

        const { data: user } = await api.get('/users/me', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })

        setAuth(user, tokens.access_token)
      } catch {
        // Refresh token expired or invalid — user stays logged out
      } finally {
        setHydrated(true)
      }
    }

    hydrate()
  }, [])

  // Don't render anything until we know auth state.
  // This prevents a flash of the login screen for returning users.
  if (!hydrated) return null

  return <>{children}</>
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthGate>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: 'black' },
                // Smooth slide animation on iOS, native on Android
                animation: 'slide_from_right',
              }}
            >
              {/* Public screens */}
              <Stack.Screen name="login" />
              <Stack.Screen name="register" />
              <Stack.Screen name="onboarding" />

              {/* Main app — swipeable tab group, protected via useRequireAuth() */}
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="settings" />

              {/* Photo-based calorie estimation flow */}
              <Stack.Screen name="nutrition-snap" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="nutrition-confirm" />

              {/* Friends + leaderboard + weekly recap */}
              <Stack.Screen name="friends" />
            </Stack>
          </AuthGate>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}