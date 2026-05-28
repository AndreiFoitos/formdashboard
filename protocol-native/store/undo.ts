import { create } from 'zustand'

interface UndoEntry {
  key: number
  label: string
  onUndo: () => void | Promise<void>
  durationMs: number
}

interface UndoState {
  current: UndoEntry | null
  show: (entry: Omit<UndoEntry, 'key'> & { durationMs?: number }) => void
  dismiss: () => void
}

let nextKey = 1

export const useUndoStore = create<UndoState>((set) => ({
  current: null,
  show: ({ label, onUndo, durationMs = 4000 }) => {
    set({ current: { key: nextKey++, label, onUndo, durationMs } })
  },
  dismiss: () => set({ current: null }),
}))

export function showUndo(entry: Omit<UndoEntry, 'key'> & { durationMs?: number }) {
  useUndoStore.getState().show(entry)
}
