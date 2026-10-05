import { useEffect, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Check, ChevronLeft } from 'lucide-react-native'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { usePitPlan, useShoppingList, type ShoppingItem } from '../hooks/usePitCrew'
import { getToken, setToken } from '../lib/storage'
import { hapticSelection } from '../lib/haptics'

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
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <View className="flex-row items-center px-4 pt-2 pb-2">
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={12}
          className="-ml-1 pr-4 py-2 flex-row items-center"
          style={{ gap: 2 }}
        >
          <ChevronLeft size={22} color="#d4d4d8" strokeWidth={2.25} />
          <Text className="text-zinc-300 text-base font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold">Shopping list</Text>
      </View>
      {list.data && (
        <Text className="text-zinc-500 text-xs px-4 mb-3">
          {fmtRange(list.data.from, list.data.to)} · {ticked.size}/{total} ticked
        </Text>
      )}

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 40, gap: 16 }}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => list.refetch()} tintColor="#71717a" />}
      >
        {list.isLoading ? (
          <ActivityIndicator color="#71717a" style={{ marginTop: 40 }} />
        ) : !list.data || list.data.aisles.length === 0 ? (
          <Text className="text-zinc-500 text-sm">Nothing to buy: your plan has no meals for the next 7 days.</Text>
        ) : (
          <>
            {list.data.aisles.map((a) => (
              <View key={a.name}>
                <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">{a.name}</Text>
                <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                  {a.items.map((i, idx) => {
                    const done = ticked.has(i.key)
                    return (
                      <TouchableOpacity
                        key={i.key}
                        onPress={() => toggle(i.key)}
                        className="px-4 py-3 flex-row items-center"
                        style={{ gap: 12, borderBottomWidth: idx === a.items.length - 1 ? 0 : 1, borderBottomColor: '#27272a' }}
                      >
                        <View
                          className="w-5 h-5 rounded-md items-center justify-center border"
                          style={{ backgroundColor: done ? '#a3e635' : 'transparent', borderColor: done ? '#a3e635' : '#52525b' }}
                        >
                          {done && <Check size={14} color="black" strokeWidth={3} />}
                        </View>
                        <Text
                          className="flex-1 text-sm"
                          style={{ color: done ? '#52525b' : 'white', textDecorationLine: done ? 'line-through' : 'none' }}
                        >
                          {i.name}
                        </Text>
                        <View className="items-end">
                          <Text className="text-sm" style={{ color: done ? '#52525b' : '#d4d4d8' }}>
                            {i.note ? 'about ' : ''}{fmtAmount(i)}
                          </Text>
                          {i.note && <Text className="text-zinc-600 text-[11px]">{i.note}</Text>}
                        </View>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>
            ))}
            <Text className="text-zinc-600 text-[11px] leading-4 text-center px-2">
              Amounts cover the plan's meals for the next 7 days, minus what you've logged today. Cooked foods are
              converted to what you buy (dry rice and pasta, raw meat), so those are approximate.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
