import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

interface CustomExercise {
  id: string
  name: string
  group_name: string
}

/**
 * Resolves an exercise key to a display name, custom exercises included.
 *
 * Built-in exercises are looked up in `base` (each screen keeps its own map).
 * Custom ones are keyed `custom_<uuid>` and only the API knows their names, so
 * call sites that fell back to the raw key rendered a user's custom exercise
 * as "custom_3f2a1b9c-4d5e-…" — which is why logging against a custom
 * exercise looked broken as soon as you left the picker.
 *
 * Shares a query key with the training screen's own custom-exercise fetch, so
 * this costs no extra request. Falls back to a humanised key rather than the
 * raw one if an exercise can't be resolved at all.
 */
export function useExerciseName(base: Record<string, string>): (key: string) => string {
  const { data } = useQuery<{ exercises: CustomExercise[] }>({
    queryKey: ['custom-exercises'],
    queryFn: () => api.get('/training/custom-exercises').then((r) => r.data),
    staleTime: 60 * 1000,
  })

  const customNames = useMemo(() => {
    const out: Record<string, string> = {}
    for (const ex of data?.exercises ?? []) out[`custom_${ex.id}`] = ex.name
    return out
  }, [data])

  return useMemo(
    () => (key: string) => {
      if (base[key]) return base[key]
      if (customNames[key]) return customNames[key]
      // Unresolved custom key: never show the uuid.
      if (key.startsWith('custom_')) return 'Custom exercise'
      return key.replace(/_/g, ' ')
    },
    [base, customNames],
  )
}
