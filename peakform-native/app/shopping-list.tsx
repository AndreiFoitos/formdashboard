import { useEffect, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Check } from 'lucide-react-native'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { usePitPlan, useShoppingList, type ShoppingItem } from '../hooks/usePitCrew'
import { getToken, setToken } from '../lib/storage'
import { hapticSelection } from '../lib/haptics'
import { colors } from '../theme/tokens'

// What to buy for the next 7 days of the Pit Crew meal plan
// (backend services/plan_shopping.py). Ticks are kept on this phone, per
// plan and start date, so a new week or a new plan starts unticked.

function fmtAmount(i: ShoppingItem): string {
  const n = i.unit === 'kg' || i.unit === 'l' ? i.amount.toFixed(1) : String(i.amount)
  return i.unit === 'eggs' ? `${n} eggs` : `${n} ${i.unit}`
}

function fmtRange(from: string, to: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }
  return `${new Date(`${from}T12:00:00`).toLocaleDateString(undefined, opts)} – ${new Date(`${to}T12:00:00`).toLocaleDateString(undefined, opts)}`
}

export default function ShoppingListScreen() {
  useRequireAuth()
  const { data: state } = usePitPlan()
  const planId = state?.plan?.id
  const list = useShoppingList(planId)
  const storageKey = planId && list.data ? `shop_${planId}_${list.data.from}` : null
  const [ticked, setTicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!storageKey) return
    getToken(storageKey)
      .then((v) => setTicked(new Set(v ? (JSON.parse(v) as string[]) : [])))
      .catch(() => {})
  }, [storageKey])

  function toggle(key: string) {
    hapticSelection()
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      if (storageKey) setToken(storageKey, JSON.stringify([...next])).catch(() => {})
      return next
    })
  }

  const total = list.data?.aisles.reduce((n, a) => n + a.items.length, 0) ?? 0

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      {list.data && (
        <Text className="text-text-subtle text-caption px-4 mb-3">
          {fmtRange(list.data.from, list.data.to)} · {ticked.size}/{total} ticked
        </Text>
      )}

      <ScrollView
        className="flex-1 px-4"
        contentContainerClassName="pb-12 gap-4"
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => list.refetch()} tintColor={colors['text-subtle']} />}
      >
        {list.isLoading ? (
          <ActivityIndicator color={colors['text-subtle']} className="mt-12" />
        ) : !list.data || list.data.aisles.length === 0 ? (
          <Text className="text-text-subtle text-footnote">Nothing to buy: your plan has no meals for the next 7 days.</Text>
        ) : (
          <>
            {list.data.aisles.map((a) => (
              <View key={a.name}>
                <Text className="text-text-subtle text-caption mb-2">{a.name}</Text>
                <View className="bg-surface border border-divider rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
                  {a.items.map((i, idx) => {
                    const done = ticked.has(i.key)
                    return (
                      <TouchableOpacity
                        key={i.key}
                        onPress={() => toggle(i.key)}
                        className="px-4 py-3 flex-row items-center gap-3"
                        style={{ borderBottomWidth: idx === a.items.length - 1 ? 0 : 1, borderBottomColor: colors.divider }}
                      >
                        <View
                          className="w-5 h-5 rounded-md items-center justify-center border"
                          style={{ borderCurve: 'continuous', backgroundColor: done ? colors.success : 'transparent', borderColor: done ? colors.success : colors['text-subtle'] }}
                        >
                          {done && <Check size={14} color={colors.bg} strokeWidth={3} />}
                        </View>
                        <Text
                          className="flex-1 text-footnote"
                          style={{ color: done ? colors['text-subtle'] : colors.text, textDecorationLine: done ? 'line-through' : 'none' }}
                        >
                          {i.name}
                        </Text>
                        <View className="items-end">
                          <Text className="text-footnote" style={{ color: done ? colors['text-subtle'] : colors.text }}>
                            {i.note ? 'about ' : ''}{fmtAmount(i)}
                          </Text>
                          {i.note && <Text className="text-text-subtle text-caption">{i.note}</Text>}
                        </View>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>
            ))}
            <Text className="text-text-subtle text-caption text-center px-2">
              Amounts cover the plan's meals for the next 7 days, minus what you've logged today. Cooked foods are
              converted to what you buy (dry rice and pasta, raw meat), so those are approximate.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
