import '../global.css'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
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
  handlePlanReadyResponse,
  handleQuickLogResponse,
  setupNotificationHandlers,
} from '../lib/notifications'
import { syncPurchasesUser } from '../lib/purchases'

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

  // RevenueCat follows the signed-in user, so purchases land on the right
  // account (backend matches RevenueCat's app user id to users.id).
  useEffect(() => {
    if (!hydrated) return
    syncPurchasesUser(user?.id ?? null).catch(() => {})
  }, [hydrated, user?.id])

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
      if (initial && !cancelled) {
        if (!handlePlanReadyResponse(initial, qc)) await handleQuickLogResponse(initial, qc)
      }
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
        if (!handlePlanReadyResponse(resp, qc)) handleQuickLogResponse(resp, qc).catch(() => {})
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

  // Returning `null` here used to leave a blank white screen for as long as
  // the refresh call took — up to the full 30s axios timeout when Render's
  // free tier has spun the backend down. No splash, no spinner, no error:
  // indistinguishable from a crash, and the first thing a cold reviewer sees.
  if (!hydrated) return <BootScreen />

  return <>{children}</>
}

/** Shown while auth hydrates. Says something after a few seconds, because a
 *  cold backend can take ~50s to wake and silence reads as a hang. */
function BootScreen() {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000)
    return () => clearTimeout(t)
  }, [])

  return (
    <View className="flex-1 bg-black items-center justify-center px-8">
      <ActivityIndicator color="#ffffff" />
      {slow && (
        <Text className="text-zinc-500 text-sm text-center mt-4">
          Waking the server up — this can take up to a minute the first time.
        </Text>
      )}
    </View>
  )
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
              {/* Packaged food by barcode (Open Food Facts via the backend) */}
              <Stack.Screen name="nutrition-barcode" options={{ animation: 'slide_from_bottom' }} />
              {/* AI body-comp estimate (image is sent to Claude and dropped — never persisted). */}
              <Stack.Screen name="body-comp-snap" options={{ animation: 'slide_from_bottom' }} />

              {/* Friends + leaderboard + weekly recap */}
              <Stack.Screen name="friends" />
              {/* Read-only training programs catalogue */}
              <Stack.Screen name="programs" />
              {/* Pit Crew: the whole week of the current plan */}
              <Stack.Screen name="plan-week" />
              <Stack.Screen name="shopping-list" />
              {/* Settings → Training & food (Pit Crew preferences) */}
              <Stack.Screen name="preferences" />
              {/* Deep-link target for gainrace://invite/<token> */}
              <Stack.Screen name="invite/[token]" />
              {/* Methodology — "How is this calculated?" surface */}
              <Stack.Screen name="methodology/index" />
              <Stack.Screen name="methodology/[topic]" />
              <Stack.Screen name="methodology/sources" />
              {/* Internal renderer instrumentation — reachable from Settings
                  only when FEATURES.avatarDevTools is on (ships off) */}
              <Stack.Screen name="avatar-lab" />
              <Stack.Screen name="avatar-edit" />
              <Stack.Screen name="combo-dex" />
              {/* Long-range charts; how far back depends on the plan */}
              <Stack.Screen name="trends" />
              {/* Plans (Free / Plus / Pro) — opened on a limit or from Settings */}
              <Stack.Screen name="paywall" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
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