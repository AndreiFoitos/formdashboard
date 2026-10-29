import { create } from 'zustand'

// The saved-meal builder's draft (Nutrition tab, "+ Build meal"). It lives
// here, not in the builder, because adding an ingredient by barcode or photo
// leaves the builder for a camera screen: those screens add to the draft and
// go back, and the Nutrition tab reopens the builder where it was.

export interface DraftItem {
  food_name: string
  grams: number
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

export type DraftSource = '/nutrition-barcode' | '/nutrition-snap'

interface MealDraftState {
  name: string
  items: DraftItem[]
  /** A camera screen to open once the builder's modals have closed. */
  leaving: DraftSource | null
  /** Reopen the builder when the Nutrition tab is back on screen. */
  resume: boolean
  setName: (name: string) => void
  add: (items: DraftItem[]) => void
  remove: (index: number) => void
  leaveTo: (route: DraftSource) => void
  left: () => void
  resumed: () => void
  reset: () => void
}

export const useMealDraft = create<MealDraftState>((set) => ({
  name: '',
  items: [],
  leaving: null,
  resume: false,
  setName: (name) => set({ name }),
  add: (items) => set((s) => ({ items: [...s.items, ...items] })),
  remove: (index) => set((s) => ({ items: s.items.filter((_, i) => i !== index) })),
  leaveTo: (route) => set({ leaving: route, resume: true }),
  left: () => set({ leaving: null }),
  resumed: () => set({ resume: false }),
  reset: () => set({ name: '', items: [], leaving: null, resume: false }),
}))

/** Round macros the way every builder item is stored. */
export function draftItem(food_name: string, grams: number, m: { calories: number; protein_g: number; carbs_g: number; fat_g: number }): DraftItem {
  return {
    food_name,
    grams: Math.round(grams),
    calories: Math.round(m.calories),
    protein_g: Math.round(m.protein_g * 10) / 10,
    carbs_g: Math.round(m.carbs_g * 10) / 10,
    fat_g: Math.round(m.fat_g * 10) / 10,
  }
}
