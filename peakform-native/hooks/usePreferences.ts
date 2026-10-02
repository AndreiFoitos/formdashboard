import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

export type Goal = 'cut' | 'maintain' | 'bulk'
export type Equipment = 'gym' | 'home_weights' | 'bodyweight'
export type Experience = 'new' | 'some' | 'experienced'
export type DietStyle = 'anything' | 'vegetarian' | 'vegan' | 'pescatarian' | 'halal' | 'kosher'
export type Cooking = 'minimal' | 'some' | 'loves'
export type HealthFlag = 'pregnant' | 'eating_disorder' | 'diabetes' | 'kidney'

/** GET /plan-ai/preferences (backend/routers/plan_ai.py). What the AI plans
 *  are built from beyond the logs. Null = not answered yet. */
export interface Preferences {
  goal: Goal | null
  equipment: Equipment | null
  experience: Experience | null
  session_minutes: number | null
  training_days: number | null
  injuries: string[]
  diet_style: DietStyle | null
  allergies: string[]
  dislikes: string[]
  cooking: Cooking | null
  /** [] = answered "None"; null = not answered. */
  health_flags: HealthFlag[] | null
  notes: string[]
}

export const EMPTY_PREFERENCES: Preferences = {
  goal: null,
  equipment: null,
  experience: null,
  session_minutes: null,
  training_days: null,
  injuries: [],
  diet_style: null,
  allergies: [],
  dislikes: [],
  cooking: null,
  health_flags: null,
  notes: [],
}

export const PREFERENCES_KEY = ['plan-ai', 'preferences']

export function usePreferences() {
  const user = useAuthStore((s) => s.user)
  return useQuery<Preferences>({
    queryKey: PREFERENCES_KEY,
    queryFn: () => api.get('/plan-ai/preferences').then((r) => r.data),
    enabled: !!user,
  })
}

/** Partial update: send only what changed. Lists replace the stored list. */
export function useSavePreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Preferences>) =>
      api.put('/plan-ai/preferences', patch).then((r) => r.data as Preferences),
    onSuccess: (data) => qc.setQueryData(PREFERENCES_KEY, data),
  })
}
