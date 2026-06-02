// The podium reveal that closes the Weekly Race. Three stands rise from a
// shared baseline in suspense order (3rd → 2nd → 1st) with the winner tallest
// in the center, Lucide medals drop in with a small bounce, and each name +
// total + days-trained fades up. Bar colors reuse the race palette
// (colorForUser) so every friend keeps the same color across both scenes.
import { useEffect, useMemo } from 'react'
import { Text, useWindowDimensions, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'
import { Award, Trophy } from 'lucide-react-native'
import type { RecapCrewMember } from '../../app/weekly-recap'
import { SusFace } from '../icons/SusFace'
import { TrustedShield } from '../icons/TrustedShield'
import { colorForUser } from './recapShared'

// Rank → medal icon + metal color. Lucide icons are stroke-only by default.
const MEDALS = {
  1: { Icon: Trophy, color: '#FCD34D' }, // gold
  2: { Icon: Award, color: '#D1D5DB' }, // silver (same ribbon shape as 3rd, silver tint)
  3: { Icon: Award, color: '#B45309' }, // bronze
} as const

// 1st is full height; 2nd/3rd step down so the winner reads tallest.
const HEIGHT_RATIO: Record<1 | 2 | 3, number> = { 1: 1, 2: 0.68, 3: 0.46 }

interface Props {
  crew: RecapCrewMember[]
  /** Bumped on Replay so the rise/drop animations re-seed from 0. */
  runId: number
}

export function PodiumCanvas({ crew, runId }: Props) {
  const { width, height } = useWindowDimensions()

  const { top3, tail } = useMemo(
    () => ({ top3: crew.slice(0, 3), tail: crew.slice(3) }),
    [crew],
  )

  const colW = Math.min(120, (width - 40 - 20) / 3)
  const barW = Math.min(88, colW * 0.66)
  const maxBarH = Math.min(220, height * 0.4)
  const rowH = maxBarH + 108

  // Visual left-to-right order: 2nd, 1st (center, tallest), 3rd.
  const stands = useMemo(
    () => [
      { member: top3[1], rank: 2 as const },
      { member: top3[0], rank: 1 as const },
      { member: top3[2], rank: 3 as const },
    ],
    [top3],
  )

  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'center',
          gap: 10,
          height: rowH,
        }}
      >
        {stands.map((s) => (
          <Stand
            key={s.rank}
            member={s.member}
            rank={s.rank}
            barW={barW}
            colW={colW}
            barH={maxBarH * HEIGHT_RATIO[s.rank]}
            // Reveal 3rd first, climax on 1st.
            delay={(3 - s.rank) * 450}
            runId={runId}
          />
        ))}
      </View>

      {/* Baseline the stands sit on. */}
      <View style={{ height: 1, backgroundColor: '#27272a' }} />

      {tail.length > 0 && <TailList tail={tail} runId={runId} />}
    </View>
  )
}

// ─── One podium stand (medal + name/stats riding on a rising bar) ───────────

function Stand({
  member,
  rank,
  barW,
  colW,
  barH,
  delay,
  runId,
}: {
  member: RecapCrewMember | undefined
  rank: 1 | 2 | 3
  barW: number
  colW: number
  barH: number
  delay: number
  runId: number
}) {
  const rise = useSharedValue(0)
  const reveal = useSharedValue(0)
  const medalDrop = useSharedValue(0)

  useEffect(() => {
    rise.value = 0
    reveal.value = 0
    medalDrop.value = 0
    if (!member) return
    rise.value = withDelay(
      delay,
      withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }),
    )
    reveal.value = withDelay(
      delay + 250,
      withTiming(1, { duration: 450, easing: Easing.out(Easing.quad) }),
    )
    medalDrop.value = withDelay(
      delay + 520,
      withTiming(1, { duration: 480, easing: Easing.out(Easing.back(2)) }),
    )
    return () => {
      cancelAnimation(rise)
      cancelAnimation(reveal)
      cancelAnimation(medalDrop)
    }
  }, [runId, delay, member, rise, reveal, medalDrop])

  const barStyle = useAnimatedStyle(() => ({ height: barH * rise.value }))
  const contentStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateY: (1 - reveal.value) * 14 }],
  }))
  const medalStyle = useAnimatedStyle(() => ({
    opacity: medalDrop.value,
    transform: [{ translateY: (1 - medalDrop.value) * -22 }],
  }))

  // Empty slot (crew smaller than 3) — keep the column so the center stays put.
  if (!member) return <View style={{ width: colW }} />

  const color = colorForUser(member.user_id)
  const { Icon, color: medalColor } = MEDALS[rank]
  const isMe = member.is_me

  return (
    <View style={{ width: colW, alignItems: 'center', justifyContent: 'flex-end' }}>
      <Animated.View
        style={[{ alignItems: 'center', marginBottom: 8, paddingHorizontal: 2 }, contentStyle]}
      >
        <Animated.View style={medalStyle}>
          <Icon size={26} color={medalColor} strokeWidth={2} />
        </Animated.View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 }}>
          <Text
            numberOfLines={1}
            style={{ color: '#fafafa', fontSize: 13, fontWeight: '700', maxWidth: colW - 24 }}
          >
            @{member.username ?? member.name}
          </Text>
          {member.is_trusted ? (
            <TrustedShield size={13} />
          ) : member.is_sus ? (
            <SusFace size={13} />
          ) : null}
        </View>
        <Text style={{ color: '#fafafa', fontSize: 12, fontWeight: '600', marginTop: 2 }}>
          {member.total_kg.toLocaleString()} kg
        </Text>
        <Text style={{ color: '#71717a', fontSize: 10, marginTop: 1 }}>
          {member.days_trained} {member.days_trained === 1 ? 'day' : 'days'}
        </Text>
        {isMe && (
          <View
            style={{
              marginTop: 4,
              backgroundColor: color,
              borderRadius: 999,
              paddingHorizontal: 7,
              paddingVertical: 1,
            }}
          >
            <Text style={{ color: '#000', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>
              YOU
            </Text>
          </View>
        )}
      </Animated.View>

      <Animated.View
        style={[
          {
            width: barW,
            backgroundColor: color,
            borderTopLeftRadius: 8,
            borderTopRightRadius: 8,
            alignItems: 'center',
            justifyContent: 'flex-end',
            overflow: 'hidden',
            borderWidth: isMe ? 2 : 0,
            borderColor: '#fafafa',
          },
          barStyle,
        ]}
      >
        <Text style={{ color: 'rgba(0,0,0,0.55)', fontSize: 22, fontWeight: '900', marginBottom: 6 }}>
          {rank}
        </Text>
      </Animated.View>
    </View>
  )
}

// ─── Places 4+ (fades in once the podium has settled) ───────────────────────

function TailList({ tail, runId }: { tail: RecapCrewMember[]; runId: number }) {
  const reveal = useSharedValue(0)

  useEffect(() => {
    reveal.value = 0
    reveal.value = withDelay(
      1450,
      withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) }),
    )
    return () => cancelAnimation(reveal)
  }, [runId, reveal])

  const style = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateY: (1 - reveal.value) * 10 }],
  }))

  return (
    <Animated.View style={[{ marginTop: 16, gap: 6 }, style]}>
      {tail.map((m, i) => (
        <View
          key={m.user_id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 10,
            backgroundColor: m.is_me ? '#18181b' : 'transparent',
          }}
        >
          <Text style={{ color: '#71717a', fontSize: 12, fontWeight: '700', width: 22 }}>
            {i + 4}
          </Text>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: colorForUser(m.user_id),
              marginRight: 8,
            }}
          />
          <Text
            numberOfLines={1}
            style={{ color: '#e4e4e7', fontSize: 13, fontWeight: '600', flex: 1 }}
          >
            @{m.username ?? m.name}
          </Text>
          {m.is_trusted ? (
            <View style={{ marginLeft: 6 }}>
              <TrustedShield size={13} />
            </View>
          ) : m.is_sus ? (
            <View style={{ marginLeft: 6 }}>
              <SusFace size={13} />
            </View>
          ) : null}
          <Text style={{ color: '#a1a1aa', fontSize: 12, marginLeft: 8 }}>
            {m.total_kg.toLocaleString()} kg
          </Text>
        </View>
      ))}
    </Animated.View>
  )
}
