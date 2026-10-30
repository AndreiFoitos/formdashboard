import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import type { Goal } from './usePreferences'
import type { Pace } from '../lib/targets'

/** backend services/energy.py Estimate. */
export interface EnergyEstimate {
  weight_kg: number | null
  bmr: number | null
  bmr_method: 'katch' | 'mifflin' | null
  body_fat_pct: number | null
  training_days: number
  formula_tdee: number | null
  measured_tdee: number | null
  /** 0–1: how much the measured burn counts. */
  confidence: number
  tdee: number | null
  avg_intake: number | null
  logged_days: number
  weigh_ins: number
  weight_trend_kg_week: number | null
  goal: Goal | null
  pace: Pace
  rate_kg_week: number
  /** The target for the goal and pace today, inside the safety limits. */
  target_kcal: number | null
  floor: number | null
  ceiling: number | null
  notes: string[]
}

export interface CalorieSuggestion {
  id: string
  week_start: string
  old_kcal: number | null
  new_kcal: number | null
  status: 'pending' | 'accepted' | 'dismissed' | 'expired' | 'none'
  reason: string
}

export interface AdaptiveCalories {
  enabled: boolean
  /** False for under-18s and health flags: calorie changes are off. */
  available: boolean
  target: number | null
  estimate: EnergyEstimate
  suggestion: CalorieSuggestion | null
}

export const ADAPTIVE_KEY = ['calories', 'adaptive']

/** GET /calories/adaptive. The server runs this week's check the first time
 *  it's asked, so reading it is all it takes for a suggestion to appear. */
export function useAdaptiveCalories(enabled = true) {
  const user = useAuthStore((s) => s.user)
  return useQuery<AdaptiveCalories>({
    queryKey: ADAPTIVE_KEY,
    queryFn: () => api.get('/calories/adaptive').then((r) => r.data),
    enabled: !!user && enabled,
    staleTime: 5 * 60 * 1000,
  })
}

/** Accept, dismiss or undo a suggestion. Accepting changes the target, so the
 *  profile, Today, Nutrition and the Pit Crew plan refresh too. */
export function useSuggestionAction() {
  const qc = useQueryClient()
  const updateUser = useAuthStore((s) => s.updateUser)
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'dismiss' | 'undo' }) =>
      api
        .post(`/calories/adaptive/${id}/${action}`)
        .then((r) => r.data as { calorie_target: number | null; protein_target_g: number | null }),
    onSuccess: (data) => {
      updateUser({ calorie_target: data.calorie_target, protein_target_g: data.protein_target_g })
      qc.invalidateQueries({ queryKey: ADAPTIVE_KEY })
      qc.invalidateQueries({ queryKey: ['nutrition-today'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['plan-ai'] })
    },
  })
}
