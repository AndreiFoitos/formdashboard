import { router, type Href } from 'expo-router'
import { create } from 'zustand'
import { useAuthStore } from '../store/auth'

// Taps on the home screen widgets open gainrace://widget/<target>
// (targets/widget/Components.swift → Links). app/+native-intent.tsx sends them
// here instead of letting the router handle them, because a plain deep link
// while the app is running pushes a second copy of the tabs on top of
// whatever is open (React Navigation 7 navigate never goes back), which
// slides in like a new app, and a tab change animates across the pager.

const TARGETS: Record<string, string> = {
  '': '/',
  home: '/',
  nutrition: '/nutrition',
  ask: '/ask',
  friends: '/friends',
}

/** gainrace://widget/nutrition → '/nutrition'; null for any other link. */
export function widgetTarget(url: string): string | null {
  const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '/').replace(/[?#].*$/, '')
  const m = /^\/+widget(?:\/+([a-z-]*))?\/*$/i.exec(path)
  if (!m) return null
  return TARGETS[(m[1] ?? '').toLowerCase()] ?? '/'
}

/** While true, the tab pager jumps instead of sliding (app/(tabs)/_layout.tsx). */
export const useInstantTabs = create<{ instant: boolean }>(() => ({ instant: false }))

let resetTimer: ReturnType<typeof setTimeout> | null = null

/** App already running: go back to the existing screen and switch tab
 *  without the slide. Signed out: the app is already on a signed-out screen
 *  (login / register), so just stay there. */
export function openFromWidget(target: string) {
  if (!useAuthStore.getState().user) return
  useInstantTabs.setState({ instant: true })
  if (resetTimer) clearTimeout(resetTimer)
  // Next tick, so the tabs have re-rendered with animation off first.
  setTimeout(() => {
    try {
      // Pops back to the tabs (or the target) if they're in the stack,
      // otherwise navigates to it.
      router.dismissTo(target as Href)
    } catch {
      // Navigation not ready; staying where we are is fine.
    }
    resetTimer = setTimeout(() => useInstantTabs.setState({ instant: false }), 1000)
  }, 0)
}
