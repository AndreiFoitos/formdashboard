import { useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { hapticSelection } from '../../lib/haptics'
import { PlanPanel } from '../../components/pit/PlanPanel'
import { ChatPanel } from '../../components/pit/ChatPanel'
import { colors } from '../../theme/tokens'

// The Pit tab (route stays "ask" so existing links keep working). Plan: the
// Pit Crew training + meal plan and today's slice of it. Chat: ask your data.
// See docs/ai-plans-design.md.

type Segment = 'plan' | 'chat'

export default function PitCrewScreen() {
  useRequireAuth()
  const [segment, setSegment] = useState<Segment>('plan')

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="px-4 pt-6 pb-3">
        <Text className="text-text-muted text-xs uppercase tracking-widest font-semibold">Pit Crew</Text>
        <View className="flex-row items-end justify-between mt-1.5">
          <Text className="text-text text-3xl font-bold">{segment === 'plan' ? 'Your Plan' : 'Ask Your Crew'}</Text>
        </View>
        <View className="flex-row bg-surface border border-divider rounded-xl p-1 mt-4">
          {(['plan', 'chat'] as Segment[]).map((s) => {
            const active = segment === s
            return (
              <TouchableOpacity
                key={s}
                onPress={() => {
                  if (!active) hapticSelection()
                  setSegment(s)
                }}
                className="flex-1 py-2 rounded-lg items-center"
                style={{ backgroundColor: active ? colors.text : 'transparent' }}
              >
                <Text className="text-sm font-semibold" style={{ color: active ? colors.bg : colors['text-muted'] }}>
                  {s === 'plan' ? 'Plan' : 'Chat'}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </View>
      {/* Both stay mounted so switching doesn't refetch or lose a draft. */}
      <View className="flex-1" style={{ display: segment === 'plan' ? 'flex' : 'none' }}>
        <PlanPanel />
      </View>
      <View className="flex-1" style={{ display: segment === 'chat' ? 'flex' : 'none' }}>
        <ChatPanel />
      </View>
    </SafeAreaView>
  )
}
