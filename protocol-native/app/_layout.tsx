import '../global.css'
import { useEffect } from 'react'
import { Stack, router } from 'expo-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
  const { setAuth, setHydrated, hydrated } = useAuthStore()

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

            {/* App screens — all protected via useRequireAuth() */}
            <Stack.Screen name="index" />
            <Stack.Screen name="training" />
            <Stack.Screen name="nutrition" />
            <Stack.Screen name="body" />
            <Stack.Screen name="ask" />
          </Stack>
        </AuthGate>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}