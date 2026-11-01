import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

// Creatine: a daily tick on Home, not a log (backend routers/creatine.py).
// Off until turned on in Settings → Creatine.

export interface CreatineStatus {
  enabled: boolean
  dose_g: number
  taken_today: boolean
  /** Days in a row ticked, through today or yesterday. */
  streak_days: number
}

export const CREATINE_KEY = ['creatine']

export function useCreatine(enabled = true) {
  return useQuery<CreatineStatus>({
    queryKey: CREATINE_KEY,
    queryFn: () => api.get('/creatine').then((r) => r.data),
    enabled,
  })
}

/** A tick counts towards the logging streak and the creatine reminder,
 *  so those refresh too. */
function useRefresh() {
  const qc = useQueryClient()
  return (data: CreatineStatus) => {
    qc.setQueryData(CREATINE_KEY, data)
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['notification-settings'] })
  }
}

export function useTickCreatine() {
  const qc = useQueryClient()
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (taken: boolean) =>
      (taken ? api.post('/creatine/today') : api.delete('/creatine/today')).then((r) => r.data as CreatineStatus),
    // Flip it straight away; the server's answer carries the new streak.
    onMutate: (taken) => {
      const prev = qc.getQueryData<CreatineStatus>(CREATINE_KEY)
      if (prev) qc.setQueryData(CREATINE_KEY, { ...prev, taken_today: taken })
      return { prev }
    },
    onError: (_e, _taken, ctx) => {
      if (ctx?.prev) qc.setQueryData(CREATINE_KEY, ctx.prev)
    },
    onSuccess: refresh,
  })
}

export function useCreatineSettings() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: { enabled?: boolean; dose_g?: number }) =>
      api.put('/creatine/settings', body).then((r) => r.data as CreatineStatus),
    onSuccess: refresh,
  })
}

/** Background tap on the reminder's Taken button. */
export async function tickCreatineFromNotification(): Promise<void> {
  await api.post('/creatine/today')
}
