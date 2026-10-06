import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

// Progressive overload targets (backend services/progression.py, routes
// /training/progression). Double progression: +reps until every set hits the
// top of the rep range, then +weight.

export type TargetKind =
  | 'first'
  | 'start'
  | 'reps'
  | 'weight'
  | 'stall'
  | 'bodyweight_reps'
  | 'bodyweight_harder'

export interface Target {
  kind: TargetKind
  weight_kg: number | null
  reps: number
  /** Rows to pre-fill the log sheet with. Empty for a first log. */
  sets: { weight_kg: number | null; reps: number }[]
  range: [number, number]
  reason: string
  ready_for_weight: boolean
  stalled: boolean
}

export interface ExerciseProgression {
  exercise: string
  target: Target
  last_date: string | null
  logged_today: boolean
  /** After a session today: what to aim for next time. */
  next: Target | null
}

export const PROGRESSION_KEY = ['training-progression']

export function useProgression(exerciseKey: string) {
  return useQuery<ExerciseProgression>({
    queryKey: [...PROGRESSION_KEY, exerciseKey],
    queryFn: () => api.get(`/training/progression/${exerciseKey}`).then((r) => r.data),
  })
}

/** {exercise_key: {ready_for_weight, stalled}} for the picker badges. */
export function useProgressionOverview() {
  return useQuery<Record<string, { kind: TargetKind; ready_for_weight: boolean; stalled: boolean }>>({
    queryKey: [...PROGRESSION_KEY, 'overview'],
    queryFn: () => api.get('/training/progression').then((r) => r.data.exercises),
    staleTime: 60 * 1000,
  })
}

export const KIND_LABEL: Record<TargetKind, string> = {
  first: 'First time',
  start: 'Starting weight',
  reps: '+1 rep',
  weight: '+ weight',
  stall: 'Stalled',
  bodyweight_reps: '+1 rep',
  bodyweight_harder: 'Make it harder',
}

export const KIND_COLOUR: Record<TargetKind, string> = {
  first: '#a1a1aa',
  start: '#a1a1aa',
  reps: '#38bdf8',
  weight: '#a3e635',
  stall: '#fbbf24',
  bodyweight_reps: '#38bdf8',
  bodyweight_harder: '#a3e635',
}

/** "82.5 kg × 8" / "80 kg × 11, 10, 9" / "Bodyweight × 10". */
export function targetHeadline(t: Target): string {
  const top = t.sets.filter((s) => s.weight_kg === t.weight_kg)
  const reps = top.length > 1 && new Set(top.map((s) => s.reps)).size > 1
    ? top.map((s) => s.reps).join(', ')
    : String(t.reps)
  if (t.weight_kg == null) return t.kind === 'first' ? `Aim for ${t.range[0]}–${t.range[1]} reps` : `Bodyweight × ${reps}`
  return `${t.weight_kg} kg × ${reps}`
}
