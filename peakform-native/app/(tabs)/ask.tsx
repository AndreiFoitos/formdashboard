import { useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { hapticSelection } from '../../lib/haptics'
import { PlanPanel } from '../../components/pit/PlanPanel'
import { ChatPanel } from '../../components/pit/ChatPanel'
import { colors } from '../../theme/tokens'

// The Pit tab (route stays "ask" so existing links keep working). Plan: your
// AI training + meal plan and today's slice of it. Chat: ask your data.
// See docs/ai-plans-design.md.

type Segment = 'plan' | 'chat'

export default function PitCrewScreen() {
  useRequireAuth()
  const [segment, setSegment] = useState<Segment>('plan')
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="px-4 pt-6 pb-3">
        {/* Same header as the other tabs: date line, then the tab name. */}
        <Text className="text-text-muted text-caption font-semibold">{today}</Text>
        <Text className="text-text text-title font-bold mt-2">Pit</Text>
        <View className="flex-row bg-surface border border-divider rounded-full p-1 mt-4" style={{ borderCurve: 'continuous' }}>
          {(['plan', 'chat'] as Segment[]).map((s) => {
            const active = segment === s
            return (
              <TouchableOpacity
                key={s}
                onPress={() => {
                  if (!active) hapticSelection()
                  setSegment(s)
                }}
                className="flex-1 py-3 rounded-full items-center"
                style={{ borderCurve: 'continuous', backgroundColor: active ? colors.text : 'transparent' }}
              >
                <Text className="text-footnote font-semibold" style={{ color: active ? colors.bg : colors['text-muted'] }}>
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
