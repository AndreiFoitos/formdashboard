import { Alert } from 'react-native'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore, type User } from '../store/auth'
import { hapticSuccess } from '../lib/haptics'
import { formatNumber as fmt } from '../lib/format'
import { ADAPTIVE_KEY, type AdaptiveCalories } from './useAdaptiveCalories'

/** PUT /users/me with a partial update. Targets and bedtime feed the Form score
 *  and caffeine curve, so those queries refresh too. */
export function useUpdateMe() {
  const updateUser = useAuthStore((s) => s.updateUser)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Partial<User>) => api.put('/users/me', payload).then((r) => r.data as User),
    onSuccess: (updated) => {
      updateUser(updated)
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['friends-list'] })
      qc.invalidateQueries({ queryKey: ADAPTIVE_KEY })
    },
  })
}

/** After goal, pace, age, sex or height change: offer the server's new
 *  calorie target for the goal and pace (backend services/energy.py, which
 *  also uses weigh-ins, food logs and body fat). Protein and water follow
 *  bodyweight only, so they don't move. Accepting keeps weekly suggestions on. */
export async function offerCalorieRecompute(
  user: User,
  qc: QueryClient,
  save: (kcal: number) => void,
  done: () => void,
) {
  let data: AdaptiveCalories
  try {
    data = await qc.fetchQuery<AdaptiveCalories>({
      queryKey: ADAPTIVE_KEY,
      queryFn: () => api.get('/calories/adaptive').then((r) => r.data),
      staleTime: 0,
    })
  } catch {
    return done()
  }
  const kcal = data.estimate.target_kcal
  const goal = data.estimate.goal
  if (!data.available || !goal || kcal == null) return done()
  if (user.calorie_target != null && Math.abs(kcal - user.calorie_target) < 10) return done()
  const what = goal === 'maintain' ? 'your goal (maintain)' : `your goal (${goal}, ${data.estimate.pace} pace)`
  Alert.alert(
    'Update calorie target?',
    user.calorie_target != null
      ? `For ${what}, your new target is ${fmt(kcal)} kcal a day. It's ${fmt(user.calorie_target)} kcal now.`
      : `For ${what}, your target is ${fmt(kcal)} kcal a day.`,
    [
      { text: 'Keep current', style: 'cancel', onPress: done },
      { text: `Use ${fmt(kcal)} kcal`, onPress: () => save(kcal) },
    ],
  )
}
