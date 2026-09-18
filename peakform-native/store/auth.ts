import { create } from 'zustand'
import type { AvatarConfig } from '../lib/avatar/config'

interface User {
  id: string
  email: string
  username: string | null
  name: string | null
  age: number | null
  height_cm: number | null
  weight_kg: number | null
  sex: 'male' | 'female' | null
  timezone: string
  sleep_hour: number
  onboarding_complete: boolean
  protein_target_g: number | null
  water_target_ml: number | null
  calorie_target: number | null
  /** 3D avatar settings; null until the user saves one. */
  avatar?: AvatarConfig | null
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