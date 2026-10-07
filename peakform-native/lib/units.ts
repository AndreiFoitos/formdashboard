import { create } from 'zustand'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { getToken, setToken } from './storage'
import { formatNumber } from './format'

// Settings → Units. The backend always stores metric (kg, cm, ml); this only
// changes what the app shows and what inputs mean. Food macros stay in grams
// in both systems — nutrition labels use grams everywhere.
//
// The choice lives on the server profile (users.units) so it follows the user
// across reinstalls and devices. The device keeps a cache so the UI renders
// instantly and works offline:
//   unit_system           cached choice
//   unit_system_pending   '1' while a local change hasn't reached the server
//   unit_system_migrated  '1' once the pre-sync device value was reconciled

export type UnitSystem = 'metric' | 'imperial'

const KEY = 'unit_system'
const PENDING_KEY = 'unit_system_pending'
const MIGRATED_KEY = 'unit_system_migrated'
const LB_PER_KG = 2.20462
const CM_PER_IN = 2.54
const ML_PER_FL_OZ = 29.5735

interface UnitsState {
  system: UnitSystem
  /** Last failed save, for the Units screen's inline error. */
  saveError: string | null
  /** Change the choice: cache it now, then save it to the server. */
  setSystem: (s: UnitSystem) => Promise<void>
}

const isSystem = (v: unknown): v is UnitSystem => v === 'metric' || v === 'imperial'

export const useUnitsStore = create<UnitsState>((set) => ({
  system: 'metric',
  saveError: null,
  setSystem: async (system) => {
    set({ system, saveError: null })
    await Promise.all([setToken(KEY, system), setToken(PENDING_KEY, '1')]).catch(() => {})
    if (!useAuthStore.getState().accessToken) return // signed out: pushed after login
    try {
      await pushUnits(system)
    } catch {
      // Keep the local choice; syncUnits retries on next app start.
      if (useUnitsStore.getState().system === system) {
        set({ saveError: "Couldn't save to your account. It's set on this phone, and we'll retry next time you open the app." })
      }
    }
  },
}))

let loaded: Promise<void> | null = null

/** App start: restore the cached choice. */
export function loadUnits(): Promise<void> {
  loaded ??= (async () => {
    try {
      const saved = await getToken(KEY)
      if (isSystem(saved)) useUnitsStore.setState({ system: saved })
    } catch {
      // Keep metric.
    }
  })()
  return loaded
}

/** PUT the choice; clears the pending flag once the server has stored it. A
 *  backend without the field ignores it and echoes no units, so the change
 *  stays pending until the server can keep it. */
async function pushUnits(system: UnitSystem): Promise<boolean> {
  const { data } = await api.put('/users/me', { units: system })
  if (data?.units !== system) return false
  await Promise.all([setToken(PENDING_KEY, '0'), setToken(MIGRATED_KEY, '1')]).catch(() => {})
  useAuthStore.getState().updateUser({ units: system })
  return true
}

async function adopt(system: UnitSystem) {
  useUnitsStore.setState({ system })
  await setToken(KEY, system).catch(() => {})
}

let syncing = false

/** After sign-in / app start, with the profile from GET /users/me. Never
 *  throws: on any failure the cached value stays and the next start retries. */
export async function syncUnits(serverUnits: unknown): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    await loadUnits()
    // Older backend without the field: the device cache stays the source.
    if (!isSystem(serverUnits)) return
    const local = useUnitsStore.getState().system
    const [pending, migrated] = await Promise.all([
      getToken(PENDING_KEY).catch(() => null),
      getToken(MIGRATED_KEY).catch(() => null),
    ])
    // An unsaved local change, or a one-time push of an 'imperial' chosen
    // before units were stored on the server (server still on the default).
    const push =
      (pending === '1' && local !== serverUnits) ||
      (migrated !== '1' && serverUnits === 'metric' && local === 'imperial')
    if (push) {
      if (await pushUnits(local)) useUnitsStore.setState({ saveError: null })
      return
    }
    await Promise.all([setToken(PENDING_KEY, '0'), setToken(MIGRATED_KEY, '1')]).catch(() => {})
    if (local !== serverUnits) await adopt(serverUnits)
  } catch {
    // Offline or server error: keep the cache, retry next start.
  } finally {
    syncing = false
  }
}

export const UNIT_SYSTEM_LABEL: Record<UnitSystem, string> = {
  metric: 'Metric',
  imperial: 'Imperial',
}

function round(n: number, decimals: number) {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/** Unit helpers bound to one system. Use `useUnits()` in components. */
export function unitsFor(system: UnitSystem) {
  const imperial = system === 'imperial'
  return {
    system,
    weightUnit: imperial ? 'lb' : 'kg',
    waterUnit: imperial ? 'fl oz' : 'ml',
    heightUnit: imperial ? 'in' : 'cm',

    /** kg → display number in the current unit. */
    weight: (kg: number, decimals = 1) => round(imperial ? kg * LB_PER_KG : kg, decimals),
    /** kg → "82.5" in the current unit, locale-grouped, trailing zeros dropped. */
    weightNum: (kg: number, decimals = 1) => formatNumber(imperial ? kg * LB_PER_KG : kg, decimals),
    /** kg → "82.5 kg" / "181.9 lb". */
    weightLabel: (kg: number, decimals = 1) =>
      `${formatNumber(imperial ? kg * LB_PER_KG : kg, decimals)} ${imperial ? 'lb' : 'kg'}`,
    /** ml → "2,800 ml" / "95 fl oz". */
    waterLabel: (ml: number) => `${formatNumber(Math.round(imperial ? ml / ML_PER_FL_OZ : ml))} ${imperial ? 'fl oz' : 'ml'}`,
    /** Display-unit number typed by the user → kg for the API. */
    // Rounded to 0.05 kg so an unchanged 220.5 lb saves back as 100 kg, not 100.017.
    weightToKg: (v: number) => (imperial ? Math.round((v / LB_PER_KG) * 20) / 20 : v),

    water: (ml: number) => Math.round(imperial ? ml / ML_PER_FL_OZ : ml),
    waterToMl: (v: number) => Math.round(imperial ? v * ML_PER_FL_OZ : v),

    /** cm → display number (inches in imperial). */
    height: (cm: number) => Math.round(imperial ? cm / CM_PER_IN : cm),
    heightToCm: (v: number) => (imperial ? round(v * CM_PER_IN, 1) : v),
    /** cm → "180 cm" or "5′11″". */
    heightLabel: (cm: number) => {
      if (!imperial) return `${Math.round(cm)} cm`
      const inches = Math.round(cm / CM_PER_IN)
      return `${Math.floor(inches / 12)}′${inches % 12}″`
    },
  }
}

export type Units = ReturnType<typeof unitsFor>

export function useUnits(): Units {
  const system = useUnitsStore((s) => s.system)
  return unitsFor(system)
}
