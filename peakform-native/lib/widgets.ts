import { create } from 'zustand'
import * as WidgetBridge from '../modules/widget-bridge'
import { useAuthStore } from '../store/auth'
import { useUnitsStore } from './units'
import { getToken, setToken } from './storage'

// Home screen widgets (docs/widgets-design.md §2). The widget never calls the
// API: the app builds a snapshot from data it already fetched and writes it to
// the App Group, and the widget only reads it. This file owns the snapshot;
// hooks/useWidgetSync.ts feeds it from the React Query cache.

// ─── Snapshot format (key `widget.snapshot.v1`, mirrored in targets/widget/Snapshot.swift) ──

export interface SnapshotToday {
  /** Local date the numbers belong to, YYYY-MM-DD. */
  date: string
  calories: number
  /** null: no calorie target, the widget shows the number without a ring. */
  calorieTarget: number | null
  proteinG: number
  proteinTargetG: number | null
  waterMl: number
  waterTargetMl: number
  caffeineMg: number
  trained: boolean
}

export interface SnapshotCaffeine {
  currentMg: number
  atBedtimeMg: number
  bedtimeHour: number
  impactLevel: 'minimal' | 'mild' | 'moderate' | 'high'
  curve: { time: string; mg: number }[]
}

export interface SnapshotPlan {
  workoutName: string | null
  restDay: boolean
  nextWorkoutName: string | null
  nextMeal: { slot: string; name: string; kcal: number } | null
  mealsLeft: number
  /** Meals in today's plan. 0 when the plan has no meal plan: the widget then
   *  hides the meal line instead of saying "All meals logged". */
  mealsPlanned: number
}

export interface SnapshotRace {
  rank: number
  of: number
  myKg: number
  gapKg: number | null
  aheadName: string | null
}

export interface WidgetSnapshot {
  v: 1
  updatedAt: string
  units: 'metric' | 'imperial'
  hideOnLockScreen: boolean
  /** Phase 3 quick-log buttons. Fixed defaults until the settings rows ship. */
  quickLog: { waterMl: number; drink: string; drinkLabel: string }
  today: SnapshotToday | null
  caffeine: SnapshotCaffeine | null
  plan: SnapshotPlan | null
  race: SnapshotRace | null
}

// ─── API shapes (only the fields the widget uses) ───────────────────────────────

export interface DashboardLike {
  date?: string
  summary?: {
    calories_eaten: number | null
    protein_g: number | null
    water_ml: number | null
    caffeine_mg: number | null
    trained: boolean
  }
  targets?: {
    calorie_target: number | null
    protein_target_g: number | null
    water_target_ml: number | null
  }
  caffeine?: {
    curve: { time: string; caffeine_mg: number }[]
    current_mg: number
    caffeine_at_bedtime: number
    sleep_impact_level: SnapshotCaffeine['impactLevel']
    bedtime_hour: number
  }
}

export interface PitTodayLike {
  workout: { name: string } | null
  rest_day: boolean
  next_workout: { name: string } | null
  meals: { name: string; slot: string; logged: boolean; totals: { calories: number } }[]
}

export interface LeaderboardLike {
  rows: { is_me: boolean; total_volume_kg: number; user: { name: string; username: string | null } }[]
}

// ─── Builders ──────────────────────────────────────────────────────────────────

/** Same fallback as the Today water card (app/(tabs)/index.tsx). */
const DEFAULT_WATER_TARGET_ML = 2500
const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack']

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const posOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

/** ISO 8601 in UTC without milliseconds — the plain form every ISO parser takes. */
export function isoUtc(input: string | number | Date): string | null {
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function buildToday(d: DashboardLike | null | undefined): SnapshotToday | null {
  if (!d?.date || !d.summary) return null
  const s = d.summary
  const t = d.targets
  return {
    date: d.date,
    calories: Math.round(num(s.calories_eaten)),
    calorieTarget: posOrNull(t?.calorie_target) != null ? Math.round(t!.calorie_target!) : null,
    proteinG: Math.round(num(s.protein_g)),
    proteinTargetG: posOrNull(t?.protein_target_g) != null ? Math.round(t!.protein_target_g!) : null,
    waterMl: Math.round(num(s.water_ml)),
    waterTargetMl: Math.round(posOrNull(t?.water_target_ml) ?? DEFAULT_WATER_TARGET_ML),
    caffeineMg: Math.round(num(s.caffeine_mg)),
    trained: !!s.trained,
  }
}

export function buildCaffeine(d: DashboardLike | null | undefined): SnapshotCaffeine | null {
  const c = d?.caffeine
  if (!c || !Array.isArray(c.curve)) return null
  const curve: SnapshotCaffeine['curve'] = []
  for (const p of c.curve) {
    const time = isoUtc(p.time)
    if (time) curve.push({ time, mg: Math.round(num(p.caffeine_mg) * 10) / 10 })
  }
  return {
    currentMg: Math.round(num(c.current_mg)),
    atBedtimeMg: Math.round(num(c.caffeine_at_bedtime)),
    bedtimeHour: num(c.bedtime_hour),
    impactLevel: c.sleep_impact_level ?? 'minimal',
    curve,
  }
}

export function buildPlan(today: PitTodayLike | null | undefined): SnapshotPlan | null {
  if (!today) return null
  const meals = Array.isArray(today.meals) ? today.meals : []
  const open = meals
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !m.logged)
    .sort((a, b) => {
      const sa = SLOT_ORDER.indexOf(a.m.slot)
      const sb = SLOT_ORDER.indexOf(b.m.slot)
      return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb) || a.i - b.i
    })
  const next = open[0]?.m
  return {
    workoutName: today.workout?.name ?? null,
    restDay: !!today.rest_day,
    nextWorkoutName: today.next_workout?.name ?? null,
    nextMeal: next ? { slot: next.slot, name: next.name, kcal: Math.round(num(next.totals?.calories)) } : null,
    mealsLeft: open.length,
    mealsPlanned: meals.length,
  }
}

export function buildRace(board: LeaderboardLike | null | undefined): SnapshotRace | null {
  const rows = Array.isArray(board?.rows) ? board!.rows : []
  // The server always includes you: one row means no accepted friends.
  if (rows.length <= 1) return null
  const i = rows.findIndex((r) => r.is_me)
  if (i === -1) return null
  const me = rows[i]
  const ahead = i > 0 ? rows[i - 1] : null
  return {
    rank: i + 1,
    of: rows.length,
    myKg: Math.round(num(me.total_volume_kg)),
    gapKg: ahead ? Math.max(0, Math.round(num(ahead.total_volume_kg) - num(me.total_volume_kg))) : null,
    aheadName: ahead ? ahead.user?.name || ahead.user?.username || null : null,
  }
}

// ─── "Hide numbers on lock screen" (device-only, Settings → Widgets) ────────────

const HIDE_KEY = 'widget_hide_lock_numbers'

interface WidgetPrefsState {
  hideOnLockScreen: boolean
  setHideOnLockScreen: (v: boolean) => void
}

export const useWidgetPrefs = create<WidgetPrefsState>((set) => ({
  hideOnLockScreen: false,
  setHideOnLockScreen: (v) => {
    set({ hideOnLockScreen: v })
    setToken(HIDE_KEY, v ? '1' : '0').catch(() => {})
    scheduleWidgetWrite()
  },
}))

let prefsLoaded: Promise<void> | null = null

export function loadWidgetPrefs(): Promise<void> {
  prefsLoaded ??= getToken(HIDE_KEY)
    .then((v) => {
      if (v === '1') {
        useWidgetPrefs.setState({ hideOnLockScreen: true })
        scheduleWidgetWrite()
      }
    })
    .catch(() => {})
  return prefsLoaded
}

// ─── Writing ───────────────────────────────────────────────────────────────────

type Sections = Pick<WidgetSnapshot, 'today' | 'caffeine' | 'plan' | 'race'>

let sections: Sections = { today: null, caffeine: null, plan: null, race: null }
let timer: ReturnType<typeof setTimeout> | null = null
/** Last snapshot this app session wrote, for the dev screen. */
let lastWritten: string | null = null

const WRITE_DEBOUNCE_MS = 500

export function setWidgetSections(partial: Partial<Sections>) {
  sections = { ...sections, ...partial }
  scheduleWidgetWrite()
}

/** Coalesces writes: one log can update several queries in a row. */
export function scheduleWidgetWrite() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    writeNow()
  }, WRITE_DEBOUNCE_MS)
}

export function composeSnapshot(): WidgetSnapshot {
  const units = useUnitsStore.getState().system
  return {
    v: 1,
    updatedAt: isoUtc(Date.now()) ?? new Date().toISOString(),
    units,
    hideOnLockScreen: useWidgetPrefs.getState().hideOnLockScreen,
    // WATER_PRESETS default (250 ml / 8 oz) and coffee; configurable in phase 3.
    quickLog: { waterMl: units === 'imperial' ? 237 : 250, drink: 'coffee', drinkLabel: 'Coffee' },
    ...sections,
  }
}

function writeNow() {
  // Never write for a signed-out app: a fetch that lands after logout must not
  // bring the widget back.
  if (!useAuthStore.getState().user) return
  // Nothing fetched yet: leave whatever is there (or the empty state).
  if (!sections.today) return
  try {
    const json = JSON.stringify(composeSnapshot())
    lastWritten = json
    WidgetBridge.setSnapshot(json)
    WidgetBridge.reloadWidgets()
  } catch {
    // Widgets are best effort; never break the app over them.
  }
}

/** Logout / account switch: widgets go back to "Open GainRace to set up". */
export function clearWidgets() {
  if (timer) clearTimeout(timer)
  timer = null
  sections = { today: null, caffeine: null, plan: null, race: null }
  lastWritten = null
  WidgetBridge.clearSnapshot()
  WidgetBridge.setWidgetToken(null)
  WidgetBridge.reloadWidgets()
}

/** Dev screen: what the widget reads (native) and what this session wrote. */
export function debugSnapshot(): { native: string | null; nativeAvailable: boolean; lastWritten: string | null; pending: WidgetSnapshot } {
  return {
    native: WidgetBridge.getSnapshot(),
    nativeAvailable: WidgetBridge.isAvailable,
    lastWritten,
    pending: composeSnapshot(),
  }
}

// Every clearAuth() path (Settings sign out, account deletion, onboarding
// sign out, failed token refresh) sets user to null; one subscription here
// covers them all, without the auth store importing native code. A different
// user signing in also starts from an empty snapshot.
useAuthStore.subscribe((state, prev) => {
  const was = prev.user?.id ?? null
  const now = state.user?.id ?? null
  if (was !== null && was !== now) clearWidgets()
})

// Units or the privacy switch changed: rewrite so the widget follows.
useUnitsStore.subscribe((state, prev) => {
  if (state.system !== prev.system) scheduleWidgetWrite()
})
