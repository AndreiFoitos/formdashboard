import { useCallback, useEffect, useRef } from 'react'
import type { View } from 'react-native'
import { create } from 'zustand'
import { getToken, setToken } from '../lib/storage'

// The app tour after onboarding (components/SpotlightTour, steps in
// lib/tour.ts). Screens mark what a step points at with useTourTarget(id);
// the overlay cuts a hole around that element's on-screen rect.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const SEEN_KEY = 'app_tour_seen'

interface TourState {
  /** Start as soon as the tabs are on screen (set by onboarding / Settings). */
  pending: boolean
  active: boolean
  step: number
  rects: Record<string, Rect>
  queue: () => void
  start: () => void
  go: (step: number) => void
  stop: () => void
  setRect: (id: string, rect: Rect) => void
}

export const useTourStore = create<TourState>((set) => ({
  pending: false,
  active: false,
  step: 0,
  rects: {},
  queue: () => set({ pending: true }),
  start: () => set({ pending: false, active: true, step: 0 }),
  go: (step) => set({ step }),
  stop: () => {
    setToken(SEEN_KEY, '1').catch(() => {})
    set({ active: false, pending: false, step: 0 })
  },
  setRect: (id, rect) => set((s) => ({ rects: { ...s.rects, [id]: rect } })),
}))

/** Queue the tour once per install (after onboarding). */
export async function queueTourOnce() {
  const seen = await getToken(SEEN_KEY).catch(() => null)
  if (!seen) useTourStore.getState().queue()
}

/** Spread onto the View a tour step points at. It re-measures on each step
 *  while the tour runs, after the tab switch has settled. */
export function useTourTarget(id: string) {
  const ref = useRef<View>(null)
  const active = useTourStore((s) => s.active)
  const step = useTourStore((s) => s.step)
  const measure = useCallback(() => {
    if (!useTourStore.getState().active) return
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) useTourStore.getState().setRect(id, { x, y, width, height })
    })
  }, [id])
  useEffect(() => {
    if (!active) return
    // Twice: the second read lands after the pager's tab-switch slide.
    const timers = [setTimeout(measure, 300), setTimeout(measure, 650)]
    return () => timers.forEach(clearTimeout)
  }, [active, step, measure])
  return { ref, onLayout: measure, collapsable: false }
}
