import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native'
import { Check, X } from 'lucide-react-native'
import { useBuildPlan, useCheckinAction, type Checkin } from '../../hooks/usePitCrew'
import { hapticSuccess } from '../../lib/haptics'
import { colors } from '../../theme/tokens'

// The weekly check-in (backend services/plan_checkin.py), shown at the top of
// the Plan side from Sunday evening to Tuesday until the user closes it.

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 bg-bg/40 rounded-xl px-3 py-2">
      <Text className="text-text text-base font-semibold">{value}</Text>
      <Text className="text-text-subtle text-[11px] mt-0.5">{label}</Text>
    </View>
  )
}

export function CheckinCard({ checkin }: { checkin: Checkin }) {
  const action = useCheckinAction()
  const build = useBuildPlan()
  const s = checkin.stats
  const trend = s.weight_trend_kg_per_week

  function apply(sid: string, kind: string) {
    action.mutate(
      { id: checkin.id, sid, action: 'apply' },
      {
        onSuccess: () => {
          hapticSuccess()
          if (kind === 'rebuild') {
            Alert.alert('Build a new plan?', 'Your current plan will be replaced. It takes a minute or two.', [
              { text: 'Not now', style: 'cancel' },
              { text: 'Build', onPress: () => build.mutate() },
            ])
          }
        },
        onError: (e: any) => Alert.alert("Couldn't apply that", e?.response?.data?.detail ?? 'Please try again.'),
      },
    )
  }

  return (
    <View className="rounded-2xl overflow-hidden border border-success/40 bg-success/10">
      <View className="px-4 pt-4 flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-success text-xs uppercase tracking-widest font-semibold">Weekly check-in</Text>
          <Text className="text-text text-base font-semibold mt-1">How your week went</Text>
        </View>
        <TouchableOpacity
          onPress={() => action.mutate({ id: checkin.id, action: 'seen' })}
          hitSlop={10}
          className="w-8 h-8 rounded-full bg-bg/40 items-center justify-center"
        >
          <X size={16} color={colors['text-muted']} />
        </TouchableOpacity>
      </View>

      <View className="flex-row px-4 mt-3" style={{ gap: 8 }}>
        <Stat label="sessions" value={`${s.sessions_done}/${s.sessions_planned}`} />
        {s.avg_kcal != null && <Stat label={`avg kcal${s.target_kcal ? ` / ${s.target_kcal}` : ''}`} value={String(s.avg_kcal)} />}
        {trend != null && <Stat label="kg / week" value={`${trend > 0 ? '+' : ''}${trend}`} />}
      </View>

      <Text className="text-text text-sm leading-6 px-4 mt-3">{checkin.review}</Text>

      {checkin.suggestions.length > 0 && (
        <View className="px-4 mt-3" style={{ gap: 8 }}>
          {checkin.suggestions.map((sg) => (
            <View key={sg.id} className="bg-bg/40 rounded-xl p-3">
              <Text className="text-text text-sm font-semibold">{sg.title}</Text>
              <Text className="text-text-muted text-xs leading-5 mt-0.5">{sg.detail}</Text>
              {sg.status === 'pending' ? (
                <View className="flex-row mt-2" style={{ gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => apply(sg.id, sg.kind)}
                    disabled={action.isPending}
                    className="bg-accent rounded-full px-4 py-1.5"
                  >
                    {action.isPending ? (
                      <ActivityIndicator size="small" color={colors['on-accent']} />
                    ) : (
                      <Text className="text-on-accent text-xs font-semibold">{sg.kind === 'rebuild' ? 'Build new plan' : 'Apply'}</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => action.mutate({ id: checkin.id, sid: sg.id, action: 'dismiss' })}
                    disabled={action.isPending}
                    className="rounded-full px-4 py-1.5 border border-border"
                  >
                    <Text className="text-text-muted text-xs font-semibold">Not now</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View className="flex-row items-center mt-2" style={{ gap: 6 }}>
                  {sg.status === 'applied' && <Check size={13} color={colors.success} strokeWidth={3} />}
                  <Text className="text-text-subtle text-xs">
                    {sg.status === 'dismissed' ? 'Skipped' : sg.result === 'rebuild' ? 'Building a new plan' : sg.result}
                  </Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
      <View className="h-4" />
    </View>
  )
}
