import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { formatNumber } from '../lib/format'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useRewards } from '../hooks/useRewards'
import { itemName, RARITY_COLOR, type DexCombo, type DexMilestone } from '../lib/avatar/rewards'
import { emoteName } from '../lib/avatar/emotes'
import { colors } from '../theme/tokens'

const GOLDEN_AFTER = 7

export default function ComboDexScreen() {
  const { data, isLoading, isRefetching, refetch } = useRewards()

  const combos = data?.dex.combos ?? []
  const milestones = data?.dex.milestones ?? []
  const foundCount = combos.filter((c) => c.found).length
  const unlockedCount = milestones.filter((m) => m.unlocked).length

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      {isLoading || !data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors['text-muted']} />
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-4"
          contentContainerClassName="pt-2 pb-12 gap-3"
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.text} />}
        >
          <Text className="text-text-muted text-caption">
            Hit a combo in one day to unlock its reward. Hit it on {GOLDEN_AFTER} days to go golden. Nothing here rewards
            overdoing caffeine or crash dieting.
          </Text>

          <SectionTitle title="Daily combos" count={`${foundCount}/${combos.length} found`} />
          {combos.map((c) => (
            <ComboCard key={c.id} combo={c} />
          ))}

          <SectionTitle title="Milestones" count={`${unlockedCount}/${milestones.length} unlocked`} />
          {!data.trusted && (
            <Text className="text-text-subtle text-caption -mt-1">
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
      <Text className="text-text text-headline font-bold">{title}</Text>
      <Text className="text-text-subtle text-caption">{count}</Text>
    </View>
  )
}

function RarityTag({ rarity, golden }: { rarity: DexCombo['rarity']; golden?: boolean }) {
  const color = golden ? RARITY_COLOR.legendary : RARITY_COLOR[rarity]
  return (
    <Text className="text-caption font-bold" style={{ color }}>
      {golden ? '✨ golden' : rarity}
    </Text>
  )
}

function ComboCard({ combo: c }: { combo: DexCombo }) {
  const locked = !c.found
  const border = c.golden ? RARITY_COLOR.legendary : c.found ? RARITY_COLOR[c.rarity] : colors.divider
  return (
    <View className="rounded-xl p-4 border" style={{ borderCurve: 'continuous', borderColor: border, backgroundColor: locked ? colors.bg : colors.surface }}>
      <View className="flex-row items-center justify-between">
        <Text className="text-body font-bold flex-1" style={{ color: locked ? colors['text-subtle'] : colors.text }}>
          {c.name}
          {c.active_today ? '  🔥 today' : ''}
        </Text>
        <RarityTag rarity={c.rarity} golden={c.golden} />
      </View>
      <Text className="text-text-muted text-caption mt-1">{c.recipe}</Text>
      <EmoteLine emote={c.emote} golden={c.emote_golden} hidden={c.secret && !c.found} />
      <View className="flex-row items-center justify-between mt-2">
        <Text className="text-text-subtle text-caption">
          {c.reward ? (
            <>
              Reward: <Text className="text-text-muted">{c.found || !c.secret ? itemName(c.reward) : '???'}</Text>
              {!c.has_art && (c.found || !c.secret) ? ' · art coming soon' : ''}
            </>
          ) : (
            'Warning only — no reward'
          )}
        </Text>
        {c.reward && (
          <Text className="text-text-muted text-caption">
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
      className="rounded-xl p-4 border"
      style={{ borderCurve: 'continuous', borderColor: m.unlocked ? color : colors.divider, backgroundColor: m.unlocked ? colors.surface : colors.bg }}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-body font-bold flex-1" style={{ color: m.unlocked ? colors.text : colors['text-muted'] }}>
          {m.name}
        </Text>
        <RarityTag rarity={m.rarity} />
      </View>
      <Text className="text-text-muted text-caption mt-1">{m.description}</Text>
      <EmoteLine emote={m.emote} golden={m.emote_golden} />
      <Text className="text-text-subtle text-caption mt-1">
        Reward: <Text className="text-text-muted">{itemName(m.reward)}</Text>
        {!m.has_art ? ' · art coming soon' : ''}
      </Text>
      {m.evaluated ? (
        <>
          <View className="h-1.5 rounded-full bg-surface-raised mt-3 overflow-hidden" style={{ borderCurve: 'continuous' }}>
            <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color }} />
          </View>
          <Text className="text-text-subtle text-caption mt-1">
            {m.unlocked
              ? 'Unlocked'
              : m.blocked_by_trust
                ? 'Done — unlocks once you become Trusted'
                : `${formatNum(m.progress ?? 0)} / ${formatNum(m.target)}`}
          </Text>
        </>
      ) : (
        <Text className="text-text-subtle text-caption mt-2">Tracking starts soon</Text>
      )}
    </View>
  )
}

function formatNum(n: number) {
  return n >= 10000 ? `${formatNumber(Math.round(n / 1000))}k` : formatNumber(Math.round(n))
}

function EmoteLine({ emote, golden, hidden }: { emote: string | null; golden: string | null; hidden?: boolean }) {
  if (!emote && !golden) return null
  return (
    <Text className="text-text-subtle text-caption mt-1">
      Emote:{' '}
      {emote && <Text className="text-text-muted">{hidden ? '???' : emoteName(emote)}</Text>}
      {emote && golden ? '  ·  ' : ''}
      {golden && (
        <Text style={{ color: RARITY_COLOR.legendary }}>
          {hidden ? '???' : emoteName(golden)} (golden)
        </Text>
      )}
    </Text>
  )
}
