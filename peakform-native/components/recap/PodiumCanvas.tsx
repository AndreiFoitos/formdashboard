// The podium reveal that closes the Weekly Race. Three stands rise from a
// shared baseline in suspense order (3rd → 2nd → 1st) with the winner tallest
// in the center, Lucide medals drop in with a small bounce, and each name +
// total + days-trained fades up. Bar colors reuse the race palette
// (colorForUser) so every friend keeps the same color across both scenes.
import { useEffect, useMemo } from 'react'
import { Image, Text, useWindowDimensions, View } from 'react-native'
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
import { AvatarCanvas } from '../avatar/AvatarCanvas'
import type { AvatarBase } from '../../lib/avatar/bodyParams'
import type { AvatarState } from '../../lib/avatar/model'
import { TrustedShield } from '../icons/TrustedShield'
import { colorForUser } from './recapShared'
import { useUnits } from '../../lib/units'
import { colors } from '../../theme/tokens'

// Rank → medal icon + metal color. Lucide icons are stroke-only by default.
const MEDALS = {
  1: { Icon: Trophy, color: colors.medal.gold },
  2: { Icon: Award, color: colors.medal.silver }, // same ribbon shape as 3rd, silver tint
  3: { Icon: Award, color: colors.medal.bronze },
} as const

// 1st is full height; 2nd/3rd step down so the winner reads tallest.
const HEIGHT_RATIO: Record<1 | 2 | 3, number> = { 1: 1, 2: 0.68, 3: 0.46 }

interface Props {
  crew: RecapCrewMember[]
  /** Bumped on Replay so the rise/drop animations re-seed from 0. */
  runId: number
  /** user_id -> avatar face image (shown above the name when available). */
  heads?: Record<string, string>
  /** user_id -> full-body 3D avatar + the emote it performs on its stand. */
  avatars?: Record<string, PodiumAvatar>
}

export interface PodiumAvatar {
  base: AvatarBase
  state: AvatarState
  emote: string
}

export function PodiumCanvas({ crew, runId, heads, avatars }: Props) {
  const { width, height } = useWindowDimensions()

  const { top3, tail } = useMemo(
    () => ({ top3: crew.slice(0, 3), tail: crew.slice(3) }),
    [crew],
  )

  const colW = Math.min(120, (width - 40 - 24) / 3) // px-5 each side, two gap-3
  const barW = Math.min(88, colW * 0.66)

  // Everything that rides ON TOP of the bar — medal, avatar, name, stats —
  // has to fit inside rowH too. The old budget of `maxBarH + 108` was smaller
  // than that stack needs on its own (~250px for 1st place), so the taller the
  // bar got the further the avatar was pushed past the top of the screen.
  // Size the avatar to the viewport first, then give the bar whatever is left.
  const avatarH = Math.min(170, Math.max(96, height * 0.2))
  const MEDAL_STACK = 26 + 8 // medal icon + its gap
  const LABEL_STACK = 4 + 20 + 4 + 16 + 16 // mt-1 + footnote name, mt-1 + two caption stat lines
  const contentH = MEDAL_STACK + avatarH + LABEL_STACK
  const maxBarH = Math.max(56, Math.min(220, height * 0.74 - contentH))
  const rowH = maxBarH + contentH

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
    <View className="flex-1 justify-center px-5">
      <View className="flex-row items-end justify-center gap-3" style={{ height: rowH }}>
        {stands.map((s) => (
          <Stand
            key={s.rank}
            member={s.member}
            head={s.member ? heads?.[s.member.user_id] : undefined}
            avatar={s.member ? avatars?.[s.member.user_id] : undefined}
            rank={s.rank}
            barW={barW}
            colW={colW}
            barH={maxBarH * HEIGHT_RATIO[s.rank]}
            avatarH={s.rank === 1 ? avatarH : avatarH * 0.82}
            // Reveal 3rd first, climax on 1st.
            delay={(3 - s.rank) * 450}
            runId={runId}
          />
        ))}
      </View>

      {/* Baseline the stands sit on. */}
      <View style={{ height: 1, backgroundColor: colors.divider }} />

      {tail.length > 0 && <TailList tail={tail} runId={runId} />}
    </View>
  )
}

// ─── One podium stand (medal + name/stats riding on a rising bar) ───────────

function Stand({
  member,
  head,
  avatar,
  rank,
  barW,
  colW,
  barH,
  avatarH,
  delay,
  runId,
}: {
  member: RecapCrewMember | undefined
  head?: string
  avatar?: PodiumAvatar
  rank: 1 | 2 | 3
  barW: number
  colW: number
  barH: number
  avatarH: number
  delay: number
  runId: number
}) {
  const u = useUnits()
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
  const headImage = head ? (
    <Image
      source={{ uri: head }}
      className="rounded-full border-2 bg-surface mt-1"
      style={{
        width: rank === 1 ? 52 : 42,
        height: rank === 1 ? 52 : 42,
        borderColor: medalColor,
      }}
    />
  ) : null

  return (
    <View style={{ width: colW, alignItems: 'center', justifyContent: 'flex-end' }}>
      <Animated.View style={[{ alignItems: 'center' }, contentStyle]}>
        <View className="items-center mb-2">
          <Animated.View style={medalStyle}>
            <Icon size={26} color={medalColor} strokeWidth={2} />
          </Animated.View>
          {avatar ? (
            // Full-body avatar doing its emote; falls back to the face image if 3D fails.
            <AvatarCanvas
              base={avatar.base}
              state={avatar.state}
              emote={avatar.emote}
              interactive={false}
              style={{ width: colW, height: avatarH }}
              errorFallback={headImage}
            />
          ) : (
            headImage
          )}
          <View className="flex-row items-center gap-1 mt-1">
            <Text
              numberOfLines={1}
              className="text-text text-footnote font-bold"
              style={{ maxWidth: colW - 24 }}
            >
              @{member.username ?? member.name}
            </Text>
            {member.is_trusted ? (
              <TrustedShield size={13} />
            ) : member.is_sus ? (
              <SusFace size={13} />
            ) : null}
          </View>
          <Text className="text-text text-caption font-semibold mt-1">
            {u.weightLabel(member.total_kg, 0)}
          </Text>
          <Text className="text-text-subtle text-caption">
            {member.days_trained} {member.days_trained === 1 ? 'day' : 'days'}
          </Text>
          {isMe && (
            <View className="mt-1 rounded-full px-2" style={{ borderCurve: 'continuous', backgroundColor: color }}>
              <Text className="text-bg text-caption font-extrabold">You</Text>
            </View>
          )}
        </View>
      </Animated.View>

      <Animated.View style={[{ width: barW, overflow: 'hidden' }, barStyle]}>
        <View
          className={`flex-1 rounded-t-md items-center justify-end overflow-hidden border-text ${isMe ? 'border-2' : ''}`}
          style={{ borderCurve: 'continuous', backgroundColor: color }}
        >
          <Text className="text-bg/55 text-title font-black mb-2">{rank}</Text>
        </View>
      </Animated.View>
    </View>
  )
}

// ─── Places 4+ (fades in once the podium has settled) ───────────────────────

function TailList({ tail, runId }: { tail: RecapCrewMember[]; runId: number }) {
  const u = useUnits()
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
    <Animated.View style={style}>
      <View className="mt-4 gap-2">
        {tail.map((m, i) => (
          <View
            key={m.user_id}
            className={`flex-row items-center py-2 px-3 rounded-md ${m.is_me ? 'bg-surface' : ''}`}
            style={{ borderCurve: 'continuous' }}
          >
            <Text className="text-text-subtle text-caption font-bold" style={{ width: 22 }}>
              {i + 4}
            </Text>
            <View
              className="w-2 h-2 rounded-full mr-2"
              style={{ borderCurve: 'continuous', backgroundColor: colorForUser(m.user_id) }}
            />
            <Text numberOfLines={1} className="text-text text-footnote font-semibold flex-1">
              @{m.username ?? m.name}
            </Text>
            {m.is_trusted ? (
              <View className="ml-2">
                <TrustedShield size={13} />
              </View>
            ) : m.is_sus ? (
              <View className="ml-2">
                <SusFace size={13} />
              </View>
            ) : null}
            <Text className="text-text-muted text-caption ml-2">
              {u.weightLabel(m.total_kg, 0)}
            </Text>
          </View>
        ))}
      </View>
    </Animated.View>
  )
}
