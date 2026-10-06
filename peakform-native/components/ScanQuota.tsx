import { Text, TouchableOpacity, View } from 'react-native'
import { PressableScale } from './PressableScale'
import { openPaywall, resetsLabel, type ScanKind, type ScanUsage } from '../hooks/usePlan'

const NOUN: Record<ScanKind, string> = { food: 'food scan', bf: 'body-fat scan', ask: 'question', plan: 'plan build' }

export function periodLabel(window: ScanUsage['window']): string {
  return window === 'day' ? 'today' : window === 'week' ? 'this week' : 'on the Free plan'
}

/** "2 food scans left today" pill; nothing while loading. */
export function ScanQuotaPill({ kind, usage }: { kind: ScanKind; usage?: ScanUsage }) {
  if (!usage) return null
  const period = periodLabel(usage.window)
  const n = usage.remaining
  return (
    <TouchableOpacity onPress={() => openPaywall(kind)} className="bg-bg/60 rounded-full px-3 py-1.5" hitSlop={8}>
      <Text className="text-text text-xs">
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
  const period = periodLabel(usage.window)
  return (
    <View className="bg-surface/95 rounded-3xl px-5 py-5 mx-6">
      <Text className="text-text text-lg font-semibold text-center">
        You've used your {usage.limit === 1 ? '' : `${usage.limit} `}
        {NOUN[kind]}{usage.limit === 1 ? '' : 's'} {period}
      </Text>
      <Text className="text-text-muted text-sm text-center mt-1">{resetsLabel(usage.resets_at)}</Text>
      <PressableScale haptic onPress={() => openPaywall(kind)} className="bg-accent rounded-2xl py-3.5 items-center mt-4">
        <Text className="text-on-accent font-bold">See plans</Text>
      </PressableScale>
      {onAlternative && (
        <TouchableOpacity onPress={onAlternative} hitSlop={8} className="items-center mt-3 py-1">
          <Text className="text-text-muted text-sm">{alternativeLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}
