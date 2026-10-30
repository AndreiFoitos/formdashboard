import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

// Smart reminder switches and the habits they're timed by (backend
// GET/PUT /notifications/settings, services/smart_notifications.py).

export interface ReminderCategory {
  key: 'meals' | 'training' | 'protein' | 'weigh_in' | 'comeback' | 'water_coffee'
  title: string
  description: string
  enabled: boolean
  /** Set when the last few were ignored; resumes on its own after that. */
  paused_until: string | null
}

export interface LearnedHabits {
  meals: { meal: 'breakfast' | 'lunch' | 'dinner'; usual_minute: number; remind_minute: number; share: number }[]
  training: { weekdays: number[]; start_minute: number; sessions: number } | null
  weigh_in: { usual_minute: number; every_days: number } | null
}

export interface ReminderSettings {
  categories: ReminderCategory[]
  habits: LearnedHabits
}

const KEY = ['notification-settings']

export function useReminderSettings(enabled = true) {
  return useQuery<ReminderSettings>({
    queryKey: KEY,
    queryFn: () => api.get('/notifications/settings').then((r) => r.data),
    enabled,
  })
}

export function useSetReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { key: ReminderCategory['key']; enabled: boolean }) =>
      api.put<ReminderSettings>('/notifications/settings', body).then((r) => r.data),
    // Flip the switch straight away; the server's answer replaces it.
    onMutate: async ({ key, enabled }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const before = qc.getQueryData<ReminderSettings>(KEY)
      if (before) {
        qc.setQueryData<ReminderSettings>(KEY, {
          ...before,
          categories: before.categories.map((c) => (c.key === key ? { ...c, enabled } : c)),
        })
      }
      return { before }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(KEY, ctx.before)
    },
    onSuccess: (data) => qc.setQueryData(KEY, data),
  })
}
