import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import type { RewardsPayload } from '../lib/avatar/rewards'

export const REWARDS_KEY = ['avatar-rewards']

/**
 * Combos/unlocks from the backend. The GET also records anything newly earned,
 * so refetch it after the user logs something (the home screen does this when
 * the dashboard summary changes).
 */
export function useRewards() {
  const user = useAuthStore((s) => s.user)
  return useQuery<RewardsPayload>({
    queryKey: REWARDS_KEY,
    queryFn: () => api.get('/avatar/rewards').then((r) => r.data),
    enabled: !!user,
    staleTime: 60 * 1000,
  })
}

export function useMarkRewardsSeen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/avatar/rewards/seen'),
    onSuccess: () => {
      qc.setQueryData<RewardsPayload>(REWARDS_KEY, (d) => (d ? { ...d, new: [] } : d))
    },
  })
}
