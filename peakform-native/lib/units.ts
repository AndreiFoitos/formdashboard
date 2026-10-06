import { create } from 'zustand'
import { getToken, setToken } from './storage'
import { formatNumber } from './format'

// Settings → Units. The backend always stores metric (kg, cm, ml); this only
// changes what the app shows and what inputs mean. Food macros stay in grams
// in both systems — nutrition labels use grams everywhere.

export type UnitSystem = 'metric' | 'imperial'

const KEY = 'unit_system'
const LB_PER_KG = 2.20462
const CM_PER_IN = 2.54
const ML_PER_FL_OZ = 29.5735

interface UnitsState {
  system: UnitSystem
  setSystem: (s: UnitSystem) => void
}

export const useUnitsStore = create<UnitsState>((set) => ({
  system: 'metric',
  setSystem: (system) => {
    set({ system })
    setToken(KEY, system).catch(() => {})
  },
}))

/** App start: restore the saved choice. */
export async function loadUnits(): Promise<void> {
  try {
    const saved = await getToken(KEY)
    if (saved === 'metric' || saved === 'imperial') useUnitsStore.setState({ system: saved })
  } catch {
    // Keep metric.
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
