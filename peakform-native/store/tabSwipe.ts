import { useCallback, useEffect, useRef } from 'react'
import { create } from 'zustand'

// Swiping between tabs is a horizontal pan on the pager. Anything inside a tab
// that also pans horizontally (swipe-to-delete rows, horizontal scrollers)
// takes a lock on touch-down and releases it on touch-up; while any lock is
// held the pager's swipe is off, so the inner gesture wins cleanly.

interface TabSwipeState {
  locks: number
  lock: () => void
  unlock: () => void
}

export const useTabSwipeStore = create<TabSwipeState>((set) => ({
  locks: 0,
  lock: () => set((s) => ({ locks: s.locks + 1 })),
  unlock: () => set((s) => ({ locks: Math.max(0, s.locks - 1) })),
}))

/** Spread onto a View wrapping a horizontal gesture inside a tab. One lock per
 *  touch, released on end, cancel or unmount, so it can never stay stuck. */
export function useTabSwipeLock() {
  const held = useRef(false)
  const release = useCallback(() => {
    if (!held.current) return
    held.current = false
    useTabSwipeStore.getState().unlock()
  }, [])
  useEffect(() => release, [release])
  return {
    onTouchStart: useCallback(() => {
      if (held.current) return
      held.current = true
      useTabSwipeStore.getState().lock()
    }, []),
    onTouchEnd: release,
    onTouchCancel: release,
  }
}
