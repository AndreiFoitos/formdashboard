import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { handleLimitError, useSetPlan } from './usePlan'

// Pit Crew plans: backend/routers/plan_ai.py. Shapes match what
// services/plan_builder.py stores and services/plan_today.py returns.

export interface PlanExercise {
  key: string
  name: string
  group: string
  sets: number
  reps_min: number
  reps_max: number
  rest_seconds: number
  note: string
  start_weight_kg: number | null
  basis: 'e1rm' | 'bodyweight' | 'none'
}

export interface TrainingDay {
  weekday: number // 0 = Monday
  name: string
  focus: string
  exercises: PlanExercise[]
}

export interface Macros {
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

export interface MealItem extends Macros {
  food: string
  grams: number
  source: 'usda' | 'estimate'
  portions: [string, number][]
}

export interface PlanMeal {
  id: string
  name: string
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  /** One line on how to make it. Missing on plans built before 2026-10-05. */
  prep?: string
  items: MealItem[]
  totals: Macros
}

export interface Targets {
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

export interface Plan {
  id: string
  status: 'ready'
  week_start: string
  created_at: string
  rationale: string
  meal_plan_enabled: boolean
  targets: Targets & { notes: string[]; warnings: string[]; tdee: number | null; tdee_source: string | null }
  plan: {
    training: { days: TrainingDay[] }
    nutrition: {
      targets: Targets
      days: { weekday: number; meals: PlanMeal[]; totals: Macros }[]
      estimated_foods: string[]
    } | null
    days_per_week: number
    session_minutes: number
  }
}

export interface PlanState {
  plan: Plan | null
  building: boolean
  last_error: string | null
}

export interface SetLog {
  weight_kg: number | null
  reps: number | null
}

export interface TodayExercise extends PlanExercise {
  suggestion: { weight_kg: number | null; reps: number; reason: string }
  last: SetLog[]
  last_date: string | null
  logged_today: SetLog[]
}

export interface Today {
  date: string
  weekday: number
  workout: (Omit<TrainingDay, 'exercises'> & { exercises: TodayExercise[] }) | null
  rest_day: boolean
  next_workout: { weekday: number; name: string } | null
  meals: (PlanMeal & { logged: boolean })[]
  targets: Targets | null
}

export interface ShoppingItem {
  key: string
  name: string
  amount: number
  unit: 'g' | 'kg' | 'ml' | 'l' | 'eggs'
  /** "dry weight" / "raw weight" when converted from a cooked amount. */
  note: string | null
}

export interface ShoppingList {
  from: string
  to: string
  aisles: { name: string; items: ShoppingItem[] }[]
}

export interface CheckinSuggestion {
  id: string
  kind: 'calories' | 'swap_exercise' | 'rebuild'
  title: string
  detail: string
  status: 'pending' | 'applied' | 'dismissed'
  /** What applying changed, or "rebuild" when the app should start a build. */
  result: string | null
}

export interface Checkin {
  id: string
  week_start: string
  stats: {
    sessions_planned: number
    sessions_done: number
    lifts_up: string[]
    meals_planned: number
    meals_logged: number
    days_food_logged: number
    avg_kcal: number | null
    target_kcal: number | null
    weight_trend_kg_per_week: number | null
  }
  review: string
  suggestions: CheckinSuggestion[]
  status: 'new' | 'seen'
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const PIT_PLAN_KEY = ['plan-ai', 'plan']
export const PIT_TODAY_KEY = ['plan-ai', 'today']

export function usePitPlan() {
  const user = useAuthStore((s) => s.user)
  return useQuery<PlanState>({
    queryKey: PIT_PLAN_KEY,
    queryFn: () => api.get('/plan-ai/plan').then((r) => r.data),
    enabled: !!user,
    // Poll while a build runs; it usually takes 1-2 minutes.
    refetchInterval: (q) => (q.state.data?.building ? 4000 : false),
  })
}

/** Keyed by plan id so a fresh build refetches; invalidating PIT_TODAY_KEY
 *  (a prefix) refreshes whichever plan is current. */
export function usePitToday(planId: string | undefined) {
  return useQuery<Today | null>({
    queryKey: [...PIT_TODAY_KEY, planId],
    queryFn: () => api.get('/plan-ai/today').then((r) => r.data.today),
    enabled: !!planId,
  })
}

export function useBuildPlan() {
  const qc = useQueryClient()
  const refreshPlan = useSetPlan()
  return useMutation({
    mutationFn: () => api.post('/plan-ai/plan'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PIT_PLAN_KEY })
      refreshPlan()
    },
    onError: (e) => {
      if (handleLimitError(e)) refreshPlan()
    },
  })
}

export function useShoppingList(planId: string | undefined) {
  return useQuery<ShoppingList>({
    queryKey: ['plan-ai', 'shopping', planId],
    queryFn: () => api.get('/plan-ai/shopping').then((r) => r.data),
    enabled: !!planId,
  })
}

/** This week's check-in (Sunday-Tuesday). The first call of the week may
 *  take a few seconds while the server writes it. */
export function useCheckin(planId: string | undefined) {
  return useQuery<Checkin | null>({
    queryKey: ['plan-ai', 'checkin', planId],
    queryFn: () => api.get('/plan-ai/checkin', { timeout: 60_000 }).then((r) => r.data.checkin),
    enabled: !!planId,
    staleTime: 10 * 60 * 1000,
  })
}

export function useCheckinAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, sid, action }: { id: string; sid?: string; action: 'apply' | 'dismiss' | 'seen' }) =>
      (action === 'seen'
        ? api.post(`/plan-ai/checkin/${id}/seen`)
        : api.post(`/plan-ai/checkin/${id}/suggestions/${sid}/${action}`)
      ).then((r) => r.data as Checkin),
    onSuccess: (data) => {
      qc.setQueriesData({ queryKey: ['plan-ai', 'checkin'] }, data)
      qc.invalidateQueries({ queryKey: PIT_PLAN_KEY })
      qc.invalidateQueries({ queryKey: PIT_TODAY_KEY })
    },
  })
}

/** Log (or undo) one of today's plan meals. */
export function useLogPlanMeal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, undo }: { id: string; undo?: boolean }) =>
      undo ? api.delete(`/plan-ai/today/meals/${id}`) : api.post(`/plan-ai/today/meals/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PIT_TODAY_KEY })
      qc.invalidateQueries({ queryKey: ['nutrition-today'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

/** Log an exercise from the plan through the normal training endpoint. */
export function useLogPlanExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { type: string; sets: SetLog[] }) =>
      api.post('/training/log-exercise', { ...body, source: 'plan' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PIT_TODAY_KEY })
      qc.invalidateQueries({ queryKey: ['training-volume'] })
      qc.invalidateQueries({ queryKey: ['exercise-history'] })
      qc.invalidateQueries({ queryKey: ['training-history'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
