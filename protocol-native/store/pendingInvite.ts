import { create } from 'zustand'

// Carries an invite token across the login flow when a logged-out user taps
// protocol://invite/<token>. The deep-link route stashes the token here and
// routes to /login; the login screen reads it, shows the inviter preview,
// and redeems after successful auth.
//
// In-memory only — if the user kills the app before logging in, the token is
// lost. That's acceptable: they can re-tap the original link.

interface PendingInviteState {
  token: string | null
  set: (token: string) => void
  clear: () => void
}

export const usePendingInviteStore = create<PendingInviteState>((set) => ({
  token: null,
  set: (token) => set({ token }),
  clear: () => set({ token: null }),
}))
