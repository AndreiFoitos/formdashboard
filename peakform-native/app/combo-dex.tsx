import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { useRewards } from '../hooks/useRewards'
import { itemName, RARITY_COLOR, type DexCombo, type DexMilestone } from '../lib/avatar/rewards'

const GOLDEN_AFTER = 7

export default function ComboDexScreen() {
  const { data, isLoading, isRefetching, refetch } = useRewards()

  const combos = data?.dex.combos ?? []
  const milestones = data?.dex.milestones ?? []
  const foundCount = combos.filter((c) => c.found).length
  const unlockedCount = milestones.filter((m) => m.unlocked).length

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <View className="flex-row items-center px-4 pt-2 pb-2">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="-ml-1 pr-4 py-2 flex-row items-center" style={{ gap: 2 }}>
          <ChevronLeft size={22} color="#d4d4d8" strokeWidth={2.25} />
          <Text className="text-zinc-300 text-base font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold">Combo Dex</Text>
      </View>

      {isLoading || !data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#a1a1aa" />
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 48, gap: 10 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#fff" />}
        >
          <Text className="text-zinc-400 text-xs">
            Hit a combo in one day to unlock its reward. Hit it on {GOLDEN_AFTER} days to go golden. Nothing here rewards
            overdoing caffeine or crash dieting.
          </Text>

          <SectionTitle title="Daily combos" count={`${foundCount}/${combos.length} found`} />
          {combos.map((c) => (
            <ComboCard key={c.id} combo={c} />
          ))}

          <SectionTitle title="Milestones" count={`${unlockedCount}/${milestones.length} unlocked`} />
          {!data.trusted && (
            <Text className="text-zinc-500 text-xs -mt-1">
              Legendary milestones also need Trusted status: get 2 vouches from your crew in one week.
            </Text>
          )}
          {milestones.map((m) => (
            <MilestoneCard key={m.id} milestone={m} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function SectionTitle({ title, count }: { title: string; count: string }) {
  return (
    <View className="flex-row items-end justify-between mt-4 mb-1">
      <Text className="text-white text-lg font-bold">{title}</Text>
      <Text className="text-zinc-500 text-xs">{count}</Text>
    </View>
  )
}

function RarityTag({ rarity, golden }: { rarity: DexCombo['rarity']; golden?: boolean }) {
  const color = golden ? RARITY_COLOR.legendary : RARITY_COLOR[rarity]
  return (
    <Text className="text-[10px] font-bold uppercase" style={{ color }}>
      {golden ? '✨ golden' : rarity}
    </Text>
  )
}

function ComboCard({ combo: c }: { combo: DexCombo }) {
  const locked = !c.found
  const border = c.golden ? RARITY_COLOR.legendary : c.found ? RARITY_COLOR[c.rarity] : '#27272a'
  return (
    <View className="rounded-2xl p-3.5 border" style={{ borderColor: border, backgroundColor: locked ? '#0c0c0e' : '#18181b' }}>
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-bold flex-1" style={{ color: locked ? '#71717a' : '#fafafa' }}>
          {c.name}
          {c.active_today ? '  🔥 today' : ''}
        </Text>
        <RarityTag rarity={c.rarity} golden={c.golden} />
      </View>
      <Text className="text-zinc-400 text-xs mt-1">{c.recipe}</Text>
      <View className="flex-row items-center justify-between mt-2">
        <Text className="text-zinc-500 text-xs">
          {c.reward ? (
            <>
              Reward: <Text className="text-zinc-300">{c.found || !c.secret ? itemName(c.reward) : '???'}</Text>
              {!c.has_art && (c.found || !c.secret) ? ' · art coming soon' : ''}
            </>
          ) : (
            'Warning only — no reward'
          )}
        </Text>
        {c.reward && (
          <Text className="text-zinc-400 text-xs">
            {Math.min(c.days, GOLDEN_AFTER)}/{GOLDEN_AFTER}
          </Text>
        )}
      </View>
    </View>
  )
}

function MilestoneCard({ milestone: m }: { milestone: DexMilestone }) {
  const pct = m.progress != null ? Math.min(1, m.progress / m.target) : 0
  const color = RARITY_COLOR[m.rarity]
  return (
    <View
      className="rounded-2xl p-3.5 border"
      style={{ borderColor: m.unlocked ? color : '#27272a', backgroundColor: m.unlocked ? '#18181b' : '#0c0c0e' }}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-bold flex-1" style={{ color: m.unlocked ? '#fafafa' : '#a1a1aa' }}>
          {m.name}
        </Text>
        <RarityTag rarity={m.rarity} />
      </View>
      <Text className="text-zinc-400 text-xs mt-1">{m.description}</Text>
      <Text className="text-zinc-500 text-xs mt-1">
        Reward: <Text className="text-zinc-300">{itemName(m.reward)}</Text>
        {!m.has_art ? ' · art coming soon' : ''}
      </Text>
      {m.evaluated ? (
        <>
          <View className="h-1.5 rounded-full bg-zinc-800 mt-2.5 overflow-hidden">
            <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color }} />
          </View>
          <Text className="text-zinc-500 text-[11px] mt-1">
            {m.unlocked
              ? 'Unlocked'
              : m.blocked_by_trust
                ? 'Done — unlocks once you become Trusted'
                : `${formatNum(m.progress ?? 0)} / ${formatNum(m.target)}`}
          </Text>
        </>
      ) : (
        <Text className="text-zinc-600 text-[11px] mt-2">Tracking starts soon</Text>
      )}
    </View>
  )
}

function formatNum(n: number) {
  return n >= 10000 ? `${Math.round(n / 1000).toLocaleString()}k` : Math.round(n).toLocaleString()
}
