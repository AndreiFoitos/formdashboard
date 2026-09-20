import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

export type PlanId = 'free' | 'plus' | 'pro'
export type ScanKind = 'food' | 'bf' | 'ask'

export interface ScanUsage {
  limit: number
  window: 'day' | 'week'
  used: number
  remaining: number
  resets_at: string | null
}

export interface PackInfo {
  id: string
  name: string
  /** The product the app should sell (the cheaper one for Pro). */
  product_id: string
  owned: boolean
  items: Record<string, string[]>
}

/** GET /billing/me (backend/routers/billing.py). */
export interface PlanPayload {
  plan: PlanId
  plan_expires_at: string | null
  scans: Record<ScanKind, ScanUsage>
  friends: { count: number; limit: number }
  /** How far back trends and the Ask context may reach. */
  history_days: number
  /** CSV export of everything (Pro). */
  export: boolean
  packs: PackInfo[]
}

export const PLAN_KEY = ['billing']

export const PLAN_NAMES: Record<PlanId, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' }

export function usePlan() {
  const user = useAuthStore((s) => s.user)
  return useQuery<PlanPayload>({
    queryKey: PLAN_KEY,
    queryFn: () => api.get('/billing/me').then((r) => r.data),
    enabled: !!user,
    staleTime: 30 * 1000,
  })
}

/** Put a fresh payload (from /billing/sync) in the cache, or refetch. */
export function useSetPlan() {
  const qc = useQueryClient()
  return (data?: PlanPayload | null) => {
    if (data) qc.setQueryData(PLAN_KEY, data)
    else qc.invalidateQueries({ queryKey: PLAN_KEY })
  }
}

export type PaywallReason = 'food' | 'bf' | 'ask' | 'friends' | 'history' | 'export'

/** If the error is a plan limit (HTTP 402), open the paywall and return true. */
export function handleLimitError(err: any): boolean {
  const detail = err?.response?.data?.detail
  if (err?.response?.status !== 402 || !detail?.code) return false
  const reason: PaywallReason =
    detail.code === 'friend_limit'
      ? 'friends'
      : detail.code === 'export_locked'
        ? 'export'
        : (detail.kind as PaywallReason) ?? 'food'
  openPaywall(reason)
  return true
}

export function openPaywall(reason?: PaywallReason) {
  router.push({ pathname: '/paywall', params: reason ? { reason } : {} })
}

/** "resets in 5h" / "resets Thu" for a scan window. */
export function resetsLabel(iso: string | null): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'resets soon'
  const h = Math.ceil(ms / 3_600_000)
  if (h < 24) return `resets in ${h}h`
  return `resets ${new Date(iso).toLocaleDateString(undefined, { weekday: 'short' })}`
}
