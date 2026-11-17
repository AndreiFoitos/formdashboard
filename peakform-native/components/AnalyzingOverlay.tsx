import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { colors } from '../theme/tokens'

export interface AnalyzeStage {
  label: string
  /** When the stage typically begins. The client can't see server progress,
   *  so stages advance on these measured timings; the last one holds until
   *  the response arrives. */
  startsAtMs: number
}

const SLOW_HINT_AFTER_MS = 20_000

/** Full-cover "Analyzing your meal…" checklist shown while a food estimate
 *  runs (photo scan, describe a meal). */
export function AnalyzingOverlay({ stages }: { stages: AnalyzeStage[] }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setElapsed(Date.now() - start), 250)
    return () => clearInterval(id)
  }, [])

  const current = stages.reduce((idx, s, i) => (elapsed >= s.startsAtMs ? i : idx), 0)

  return (
    <View
      className="absolute inset-0 bg-bg/85 items-center justify-center px-8"
      pointerEvents="auto"
    >
      <Text className="text-text text-body font-medium mb-5">Analyzing your meal…</Text>
      <View className="gap-4">
        {stages.map((s, i) => {
          const done = i < current
          const active = i === current
          return (
            <View key={s.label} className="flex-row items-center gap-3">
              <View className="w-5 h-5 items-center justify-center">
                {done ? (
                  <Check size={16} color={colors.success} strokeWidth={2.5} />
                ) : active ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <View className="w-1.5 h-1.5 rounded-full bg-text-subtle" style={{ borderCurve: 'continuous' }} />
                )}
              </View>
              <Text
                className="text-footnote"
                style={{ color: done ? colors['text-muted'] : active ? colors.text : colors['text-subtle'] }}
              >
                {s.label}
              </Text>
            </View>
          )
        })}
      </View>
      {elapsed > SLOW_HINT_AFTER_MS && (
        <Text className="text-text-subtle text-caption mt-6 text-center">
          Taking a little longer than usual…
        </Text>
      )}
    </View>
  )
}
