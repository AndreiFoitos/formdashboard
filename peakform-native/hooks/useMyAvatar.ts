import { useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { hapticSuccess } from '../lib/haptics'
import {
  bodyFromMetrics,
  DEFAULT_LOOK,
  resolveBody,
  type AvatarConfig,
  type ResolvedBody,
} from '../lib/avatar/config'
import type { AvatarBase, BodyParams } from '../lib/avatar/bodyParams'

interface BodyHistoryStats {
  stats: { current_weight_kg: number | null; current_body_fat_pct: number | null } | null
}

export interface MyAvatar {
  base: AvatarBase
  config: AvatarConfig
  /** Body computed from the latest metrics right now. */
  current: BodyParams
  /** Body to render (applied one, or current if never applied). */
  body: ResolvedBody
  hasSaved: boolean
}

/** The signed-in user's avatar: saved look + latest metrics (incl. logged body fat). */
export function useMyAvatar(): MyAvatar {
  const user = useAuthStore((s) => s.user)
  const base: AvatarBase = user?.sex ?? 'male'

  // Same key/range as the Body tab, so this reuses its cache.
  const { data } = useQuery<BodyHistoryStats>({
    queryKey: ['body-history', 90],
    queryFn: () => api.get('/body/history?days=90').then((r) => r.data),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  })

  return useMemo(() => {
    const config: AvatarConfig = user?.avatar ?? { v: 1, look: DEFAULT_LOOK }
    const current = bodyFromMetrics({
      sex: base,
      age: user?.age,
      heightCm: user?.height_cm,
      weightKg: data?.stats?.current_weight_kg ?? user?.weight_kg,
      bodyFatPct: data?.stats?.current_body_fat_pct,
    })
    return { base, config, current, body: resolveBody(config, current), hasSaved: !!user?.avatar }
  }, [user?.avatar, user?.age, user?.height_cm, user?.weight_kg, base, data?.stats])
}

export function useSaveAvatar(onSaved?: () => void) {
  const updateUser = useAuthStore((s) => s.updateUser)
  return useMutation({
    mutationFn: (avatar: AvatarConfig) => api.put('/users/me', { avatar }).then((r) => r.data),
    onSuccess: (updated) => {
      updateUser(updated)
      hapticSuccess()
      onSaved?.()
    },
  })
}
