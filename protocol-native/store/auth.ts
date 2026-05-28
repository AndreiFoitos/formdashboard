import { create } from 'zustand'

interface User {
  id: string
  email: string
  name: string | null
  age: number | null
  height_cm: number | null
  weight_kg: number | null
  goal: string | null
  timezone: string
  sleep_hour: number
  onboarding_complete: boolean
  protein_target_g: number | null
  water_target_ml: number | null
  calorie_target: number | null
  created_at: string
}

interface AuthState {
  user: User | null
  accessToken: string | null
  hydrated: boolean

  setAuth: (user: User, token: string) => void
  updateUser: (partial: Partial<User>) => void
  clearAuth: () => void
  setHydrated: (value: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  hydrated: false,

  setAuth: (user, token) => {
    set({
      user,
      accessToken: token,
    })
  },

  updateUser: (partial) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...partial } : null,
    })),

  clearAuth: () => {
    set({
      user: null,
      accessToken: null,
    })
  },

  setHydrated: (value) => {
    set({ hydrated: value })
  },
}))