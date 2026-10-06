import { Alert } from 'react-native'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore, type User } from '../store/auth'
import { hapticSuccess } from '../lib/haptics'
import { formatNumber as fmt } from '../lib/format'
import { calorieTarget, freqFromDays, type GoalKey } from '../lib/targets'
import { PREFERENCES_KEY, type Preferences } from './usePreferences'

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
    },
  })
}

/** After age, sex or height change: offer the recomputed calorie target for the
 *  user's goal. Protein and water follow bodyweight only, so they don't move. */
export function offerCalorieRecompute(
  user: User,
  qc: QueryClient,
  save: (kcal: number) => void,
  done: () => void,
) {
  const prefs = qc.getQueryData<Preferences>(PREFERENCES_KEY)
  const body = qc.getQueryData<{ stats?: { current_weight_kg: number | null } | null }>(['body-history', 90])
  const weight = body?.stats?.current_weight_kg ?? user.weight_kg
  if (!user.sex || !user.age || !user.height_cm || !weight) return done()
  const goal: GoalKey = prefs?.goal ?? 'maintain'
  const kcal = calorieTarget(goal, user.sex, weight, user.height_cm, user.age, freqFromDays(prefs?.training_days))
  if (user.calorie_target != null && Math.abs(kcal - user.calorie_target) < 10) return done()
  Alert.alert(
    'Update calorie target?',
    user.calorie_target != null
      ? `For your goal (${goal}), your new estimate is ${fmt(kcal)} kcal a day. It's ${fmt(user.calorie_target)} kcal now.`
      : `For your goal (${goal}), your estimate is ${fmt(kcal)} kcal a day.`,
    [
      { text: 'Keep current', style: 'cancel', onPress: done },
      { text: `Use ${fmt(kcal)} kcal`, onPress: () => save(kcal) },
    ],
  )
}
