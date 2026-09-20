import { Text, TouchableOpacity, View } from 'react-native'
import { PressableScale } from './PressableScale'
import { openPaywall, resetsLabel, type ScanKind, type ScanUsage } from '../hooks/usePlan'

const NOUN: Record<ScanKind, string> = { food: 'food scan', bf: 'body-fat scan', ask: 'question' }

/** "2 food scans left today" pill; nothing while loading. */
export function ScanQuotaPill({ kind, usage }: { kind: ScanKind; usage?: ScanUsage }) {
  if (!usage) return null
  const period = usage.window === 'day' ? 'today' : 'this week'
  const n = usage.remaining
  return (
    <TouchableOpacity onPress={() => openPaywall(kind)} className="bg-black/60 rounded-full px-3 py-1.5" hitSlop={8}>
      <Text className="text-white text-xs">
        {n} {NOUN[kind]}{n === 1 ? '' : 's'} left {period}
      </Text>
    </TouchableOpacity>
  )
}

/** Shown instead of the shutter when the plan's scans are used up. */
export function ScanLimitCard({
  kind,
  usage,
  onAlternative,
  alternativeLabel,
}: {
  kind: ScanKind
  usage: ScanUsage
  onAlternative?: () => void
  alternativeLabel?: string
}) {
  const period = usage.window === 'day' ? 'today' : 'this week'
  return (
    <View className="bg-zinc-900/95 rounded-3xl px-5 py-5 mx-6">
      <Text className="text-white text-lg font-semibold text-center">
        You've used your {usage.limit === 1 ? '' : `${usage.limit} `}
        {NOUN[kind]}{usage.limit === 1 ? '' : 's'} {period}
      </Text>
      <Text className="text-zinc-400 text-sm text-center mt-1">{resetsLabel(usage.resets_at)}</Text>
      <PressableScale haptic onPress={() => openPaywall(kind)} className="rounded-2xl py-3.5 items-center mt-4" style={{ backgroundColor: '#facc15' }}>
        <Text className="text-black font-bold">See plans</Text>
      </PressableScale>
      {onAlternative && (
        <TouchableOpacity onPress={onAlternative} hitSlop={8} className="items-center mt-3 py-1">
          <Text className="text-zinc-300 text-sm">{alternativeLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}
