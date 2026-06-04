import { View, Text } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

// Inline morning-briefing block. Renders inside the Form Score card so the
// briefing sits right under the score. Returns null while loading or when
// the AI service isn't configured / has no data, so the card collapses
// cleanly to just the score row in those cases.
export function AiDigest() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ai-digest'],
    queryFn: () => api.get('/ai/digest').then((r) => r.data.digest as string),
    staleTime: 30 * 60 * 1000,
    retry: false,
  })

  if (isLoading || isError || !data) return null

  return (
    <View className="border-t border-zinc-800 mt-4 pt-4">
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
        Morning Briefing
      </Text>
      <Text className="text-zinc-200 text-sm leading-6">{data}</Text>
    </View>
  )
}
