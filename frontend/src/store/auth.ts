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
  onboarding_complete: boolean
  protein_target_g: number | null
  water_target_ml: number | null
  calorie_target: number | null
  created_at: string
}

interface AuthState {
  user: User | null
  accessToken: string | null
  setAuth: (user: User, accessToken: string) => void
  updateUser: (partial: Partial<User>) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,

  setAuth: (user, accessToken) => set({ user, accessToken }),

  updateUser: (partial) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...partial } : null,
    })),

  clearAuth: () => {
    localStorage.removeItem('refresh_token')
    set({ user: null, accessToken: null })
  },
}))