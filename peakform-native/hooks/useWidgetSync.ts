import { useEffect } from 'react'
import { AppState } from 'react-native'
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { getToken } from '../lib/storage'
import {
  buildCaffeine,
  buildPlan,
  buildRace,
  buildToday,
  clearWidgets,
  loadWidgetPrefs,
  setWidgetSections,
  type DashboardLike,
  type LeaderboardLike,
  type PitTodayLike,
} from '../lib/widgets'
import { PIT_PLAN_KEY, PIT_TODAY_KEY, type PlanState } from './usePitCrew'

// Keeps the home screen widget snapshot in step with the app
// (docs/widgets-design.md §2.1). Mounted once, in the root layout.
//
// No logging screen changes: every log already invalidates ['dashboard'], and
// the refetch lands here through the cache listener. Writes are debounced in
// lib/widgets.ts. Logout clearing lives there too (auth store subscription).

const PREFETCH_STALE_MS = 5 * 60 * 1000

/** Turns one successful query into its snapshot section(s). */
function applyQuery(qc: QueryClient, key: QueryKey, data: unknown) {
  const [head, second, third] = key as unknown[]
  if (head === 'dashboard' && key.length === 1) {
    const d = data as DashboardLike | undefined
    setWidgetSections({ today: buildToday(d), caffeine: buildCaffeine(d) })
  } else if (head === 'friends-leaderboard' && key.length === 2 && second === null) {
    // [.., null] is the all-exercises board the Today race card shows.
    setWidgetSections({ race: buildRace(data as LeaderboardLike | undefined) })
  } else if (head === PIT_TODAY_KEY[0] && second === PIT_TODAY_KEY[1]) {
    // Older plans can still sit in the cache; only the current one counts.
    const currentId = qc.getQueryData<PlanState>(PIT_PLAN_KEY)?.plan?.id
    if (currentId && third !== currentId) return
    setWidgetSections({ plan: buildPlan(data as PitTodayLike | null | undefined) })
  } else if (head === PIT_PLAN_KEY[0] && second === PIT_PLAN_KEY[1]) {
    // No ready plan: the widget hides the plan block (§2.2). A ready plan is
    // filled in by its "today" query above.
    if (!(data as PlanState | undefined)?.plan) setWidgetSections({ plan: null })
  }
}

/** Foreground refresh, so the race and plan blocks don't wait for a visit to
 *  Training or Pit. Each one is skipped while its data is fresh. */
async function prefetch(qc: QueryClient) {
  await Promise.allSettled([
    qc.prefetchQuery({
      queryKey: ['dashboard'],
      queryFn: () => api.get('/dashboard').then((r) => r.data),
      // The Today tab refetches on its own; this only covers a new day.
      staleTime: 60 * 1000,
    }),
    qc.prefetchQuery({
      queryKey: ['friends-leaderboard', null],
      queryFn: () => api.get('/friends/leaderboard').then((r) => r.data),
      staleTime: PREFETCH_STALE_MS,
    }),
    (async () => {
      const state = await qc.fetchQuery<PlanState>({
        queryKey: PIT_PLAN_KEY,
        queryFn: () => api.get('/plan-ai/plan').then((r) => r.data),
        staleTime: PREFETCH_STALE_MS,
      })
      const id = state?.plan?.id
      if (id) {
        await qc.prefetchQuery({
          queryKey: [...PIT_TODAY_KEY, id],
          queryFn: () => api.get('/plan-ai/today').then((r) => r.data.today),
          staleTime: PREFETCH_STALE_MS,
        })
      }
    })(),
  ])
}

export function useWidgetSync() {
  const qc = useQueryClient()
  const hydrated = useAuthStore((s) => s.hydrated)
  const userId = useAuthStore((s) => s.user?.id ?? null)

  // Started signed out with no saved session (e.g. the session expired while
  // the app was closed): show the logged-out widget. A saved session that
  // only failed to refresh (offline) keeps the last snapshot.
  useEffect(() => {
    if (!hydrated || userId) return
    getToken('refresh_token')
      .then((t) => {
        if (!t) clearWidgets()
      })
      .catch(() => {})
  }, [hydrated, userId])

  useEffect(() => {
    if (!userId) return
    loadWidgetPrefs()
    const cache = qc.getQueryCache()

    // Data fetched before this mounted.
    for (const q of cache.getAll()) {
      if (q.state.status === 'success') applyQuery(qc, q.queryKey, q.state.data)
    }

    const unsubscribe = cache.subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return
      applyQuery(qc, event.query.queryKey, event.query.state.data)
    })

    prefetch(qc)
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') prefetch(qc)
    })

    return () => {
      unsubscribe()
      sub.remove()
    }
  }, [userId, qc])
}
