import '../global.css'
import { useEffect, useRef } from 'react'
import { Stack, router } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import * as Sentry from '@sentry/react-native'
import { useAuthStore } from '../store/auth'
import { getToken } from '../lib/storage'
import { api } from '../api/client'
import {
  enablePredictiveNudges,
  handleQuickLogResponse,
  setupNotificationHandlers,
} from '../lib/notifications'

// ── Sentry — fire-and-forget crash + JS error reporting ──────────────────────
// DSN comes from EXPO_PUBLIC_SENTRY_DSN set per-profile in eas.json. When the
// var is empty/unset (dev, or pre-Sentry-signup), init becomes a no-op so the
// app continues to work. Once you (the developer) provide a DSN via Railway
// for backend AND eas.json for the RN build, this starts shipping breadcrumbs.
const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    // Sample 10% of sessions in prod — enough signal without burning your
    // free-tier quota. Bump later if you upgrade plans.
    tracesSampleRate: 0.1,
    // Don't auto-instrument the bundled fetch — Axios already wraps our
    // backend calls and double-recording duplicates breadcrumbs.
    enableNativeFramesTracking: false,
  })
}

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

  // Once a user is authed, make sure notifications are wired and the push
  // token is registered with the backend. Idempotent — no-ops if already set up.
  useEffect(() => {
    if (!user) return
    enablePredictiveNudges().catch(() => {})
  }, [user?.id])

  // Cold-start case: app launched from a notification tap. Handle the queued
  // response once auth has hydrated so we have a bearer token to POST with.
  useEffect(() => {
    if (!hydrated || !user) return
    let cancelled = false
    ;(async () => {
      const N = await import('expo-notifications')
      const initial = await N.getLastNotificationResponseAsync()
      if (initial && !cancelled) await handleQuickLogResponse(initial, qc)
    })().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [hydrated, user?.id])

  // Warm-start case: notification tapped while the app is alive.
  useEffect(() => {
    let sub: { remove: () => void } | undefined
    ;(async () => {
      await setupNotificationHandlers()
      const N = await import('expo-notifications')
      sub = N.addNotificationResponseReceivedListener((resp) => {
        handleQuickLogResponse(resp, qc).catch(() => {})
      })
    })().catch(() => {})
    return () => sub?.remove()
  }, [qc])

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

function RootLayout() {
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
              {/* AI body-comp estimate (image is sent to Claude and dropped — never persisted). */}
              <Stack.Screen name="body-comp-snap" options={{ animation: 'slide_from_bottom' }} />

              {/* Friends + leaderboard + weekly recap */}
              <Stack.Screen name="friends" />
              {/* Read-only training programs catalogue */}
              <Stack.Screen name="programs" />
              {/* Deep-link target for protocol://invite/<token> */}
              <Stack.Screen name="invite/[token]" />
              {/* Methodology — "How is this calculated?" surface */}
              <Stack.Screen name="methodology/index" />
              <Stack.Screen name="methodology/[topic]" />
              <Stack.Screen name="methodology/sources" />
              {/* Cinematic full-screen Weekly Race recap (Sun-Mon hero card → modal) */}
              <Stack.Screen
                name="weekly-recap"
                options={{
                  presentation: 'fullScreenModal',
                  animation: 'fade',
                  contentStyle: { backgroundColor: '#000' },
                }}
              />
            </Stack>
          </AuthGate>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

// Only wrap when init actually ran. Calling Sentry.wrap before Sentry.init
// emits a benign-but-noisy "App Start Span could not be finished" warning;
// gating here keeps Expo Go / DSN-less dev runs clean.
export default sentryDsn ? Sentry.wrap(RootLayout) : RootLayout