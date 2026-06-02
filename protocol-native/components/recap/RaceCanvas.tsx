import { useEffect, useMemo } from 'react'
import { Text, View } from 'react-native'
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg'
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import type { RecapCrewMember } from '../../app/weekly-recap'
import { SusFace } from '../icons/SusFace'
import { TrustedShield } from '../icons/TrustedShield'
import { colorForUser, formatKg, RACE_DURATION_MS } from './recapShared'

// ─── Animation contract ─────────────────────────────────────────────────────
// `progress` is a shared value that travels 0 → 7 across RACE_DURATION_MS.
// Integer values mark the end of each weekday: 0=before Mon's data lands,
// 1=Mon done, 2=Tue done, ... 7=Sun done. Fractions interpolate within a day.
// Color + timing live in ./recapShared so the podium agrees on both.

const TOP_N_VISIBLE = 5

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// Chart padding inside the canvas, leaving room for axes + marker labels.
const PAD = { left: 44, right: 92, top: 16, bottom: 36 } as const

/**
 * Round a number up to a "nice" axis max — a small set of clean multipliers
 * times a power of 10. Keeps Y-axis ticks readable while fitting the week's
 * data tightly (25.3k → 30k, not 50k, so the race isn't squished low).
 */
function niceMax(n: number): number {
  if (n <= 0) return 1000
  const pow = Math.pow(10, Math.floor(Math.log10(n)))
  const norm = n / pow
  const stops = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]
  for (const s of stops) {
    if (norm <= s) return s * pow
  }
  return 10 * pow
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  crew: RecapCrewMember[]
  width: number
  height: number
  /** Bumped on Replay so animations re-seed from 0. */
  runId: number
}

// ─── Main canvas ────────────────────────────────────────────────────────────

export function RaceCanvas({ crew, width, height, runId }: Props) {
  const chartW = width - PAD.left - PAD.right
  const chartH = height - PAD.top - PAD.bottom

  // Auto-scale Y to weekly max + 10% padding, rounded up to a nice number.
  const yMax = useMemo(() => {
    const rawMax = Math.max(0, ...crew.map((c) => c.total_kg))
    return niceMax(rawMax * 1.1 || 1000)
  }, [crew])

  const yTicks = useMemo(() => [0, yMax / 4, yMax / 2, (3 * yMax) / 4, yMax], [yMax])

  // Pre-compute "is this member in top N at end of day d?" once per crew change.
  // Avoids re-sorting on the UI thread for every animation reaction.
  const visibilityByDay = useMemo(() => computeVisibilityByDay(crew), [crew])

  // Animation driver: 0 → 7 over RACE_DURATION_MS.
  const progress = useSharedValue(0)

  useEffect(() => {
    progress.value = 0
    progress.value = withTiming(7, {
      duration: RACE_DURATION_MS,
      easing: Easing.linear,
    })
    return () => cancelAnimation(progress)
  }, [runId, progress])

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <ChartFrame
          yTicks={yTicks}
          yMax={yMax}
          chartW={chartW}
          chartH={chartH}
        />
        {crew.map((member) => (
          <CrewLine
            key={member.user_id}
            member={member}
            color={colorForUser(member.user_id)}
            yMax={yMax}
            chartW={chartW}
            chartH={chartH}
            visibilityByDay={visibilityByDay}
            progress={progress}
          />
        ))}
      </Svg>

      <DayLabels chartW={chartW} chartH={chartH} progress={progress} />

      {crew.map((member) => (
        <CrewMarker
          key={`marker-${member.user_id}`}
          member={member}
          color={colorForUser(member.user_id)}
          yMax={yMax}
          chartW={chartW}
          chartH={chartH}
          visibilityByDay={visibilityByDay}
          progress={progress}
        />
      ))}
    </View>
  )
}

// ─── Chart frame (axes, ticks, grid) ────────────────────────────────────────

function ChartFrame({
  yTicks,
  yMax,
  chartW,
  chartH,
}: {
  yTicks: number[]
  yMax: number
  chartW: number
  chartH: number
}) {
  return (
    <>
      {yTicks.map((t, i) => {
        const y = PAD.top + chartH - (t / yMax) * chartH
        return (
          <Line
            key={`grid-${i}`}
            x1={PAD.left}
            x2={PAD.left + chartW}
            y1={y}
            y2={y}
            stroke="#27272a"
            strokeWidth={1}
            strokeDasharray={t === 0 ? undefined : '2 4'}
          />
        )
      })}
      {yTicks.map((t, i) => {
        const y = PAD.top + chartH - (t / yMax) * chartH
        return (
          <SvgText
            key={`tick-${i}`}
            x={PAD.left - 6}
            y={y + 3}
            fontSize={10}
            fill="#71717a"
            textAnchor="end"
          >
            {formatKg(t)}
          </SvgText>
        )
      })}
    </>
  )
}

// ─── Per-crew-member line ───────────────────────────────────────────────────

const AnimatedPath = Animated.createAnimatedComponent(Path)

function CrewLine({
  member,
  color,
  yMax,
  chartW,
  chartH,
  visibilityByDay,
  progress,
}: {
  member: RecapCrewMember
  color: string
  yMax: number
  chartW: number
  chartH: number
  visibilityByDay: string[][]
  progress: SharedValue<number>
}) {
  const cum = member.daily_cumulative_kg
  const userId = member.user_id

  const initialVisible = isIn(visibilityByDay[0], userId)
  const opacity = useSharedValue(initialVisible ? 1 : 0)

  useAnimatedReaction(
    () => Math.min(6, Math.max(0, Math.floor(progress.value))),
    (day) => {
      const visible = isIn(visibilityByDay[day], userId)
      opacity.value = withTiming(visible ? 1 : 0, { duration: 500 })
    },
    [visibilityByDay],
  )

  const animatedProps = useAnimatedProps(() => ({
    d: buildPath(cum, progress.value, chartW, chartH, yMax),
    opacity: opacity.value,
  }))

  return (
    <AnimatedPath
      animatedProps={animatedProps}
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  )
}

// ─── Marker (colored dot + username + verdict badge) ────────────────────────

function CrewMarker({
  member,
  color,
  yMax,
  chartW,
  chartH,
  visibilityByDay,
  progress,
}: {
  member: RecapCrewMember
  color: string
  yMax: number
  chartW: number
  chartH: number
  visibilityByDay: string[][]
  progress: SharedValue<number>
}) {
  const cum = member.daily_cumulative_kg
  const userId = member.user_id
  const label = `@${member.username ?? member.name}`

  // Visibility — mirrors CrewLine so dot + line appear/disappear together.
  const initialVisible = isIn(visibilityByDay[0], userId)
  const opacity = useSharedValue(initialVisible ? 1 : 0)

  useAnimatedReaction(
    () => Math.min(6, Math.max(0, Math.floor(progress.value))),
    (day) => {
      const visible = isIn(visibilityByDay[day], userId)
      opacity.value = withTiming(visible ? 1 : 0, { duration: 500 })
    },
    [visibilityByDay],
  )

  // Verdict badge fade-in. Only the end-state badge gets a crossing day
  // surfaced from the backend, so we just animate the relevant one.
  const badgeOpacity = useSharedValue(0)
  const showTrusted = member.is_trusted && member.trusted_crossed_on_day != null
  const showSus = member.is_sus && member.sus_crossed_on_day != null
  // ISO day (1=Mon..7=Sun) → progress threshold (Mon's segment ends at p=1).
  const badgeAt =
    showTrusted ? (member.trusted_crossed_on_day! - 1)
    : showSus  ? (member.sus_crossed_on_day! - 1)
    : null

  useAnimatedReaction(
    () => progress.value,
    (p) => {
      if (badgeAt == null) return
      if (p >= badgeAt && badgeOpacity.value < 1) {
        badgeOpacity.value = withTiming(1, { duration: 500 })
      }
    },
  )

  const markerStyle = useAnimatedStyle(() => {
    const { x, y } = pointAt(cum, progress.value, chartW, chartH, yMax)
    return {
      transform: [{ translateX: x - 4 }, { translateY: y - 12 }],
      opacity: opacity.value,
    }
  })

  const badgeStyle = useAnimatedStyle(() => ({ opacity: badgeOpacity.value }))

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: PAD.left,
          top: PAD.top,
          flexDirection: 'row',
          alignItems: 'center',
        },
        markerStyle,
      ]}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: color,
          marginRight: 4,
        }}
      />
      <Text
        style={{
          color: '#fafafa',
          fontSize: 11,
          fontWeight: '600',
          textShadowColor: '#000',
          textShadowRadius: 4,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {(showTrusted || showSus) && (
        <Animated.View style={[{ marginLeft: 4 }, badgeStyle]}>
          {showTrusted ? <TrustedShield size={12} /> : <SusFace size={12} />}
        </Animated.View>
      )}
    </Animated.View>
  )
}

// ─── Day labels (M T W T F S S) with current-day highlight ──────────────────

function DayLabels({
  chartW,
  chartH,
  progress,
}: {
  chartW: number
  chartH: number
  progress: SharedValue<number>
}) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: PAD.left,
        top: PAD.top + chartH + 8,
        width: chartW,
        height: 18,
      }}
    >
      {DAY_LABELS.map((d, i) => (
        <DayLabel key={i} day={i} label={d} chartW={chartW} progress={progress} />
      ))}
    </View>
  )
}

function DayLabel({
  day,
  label,
  chartW,
  progress,
}: {
  day: number
  label: string
  chartW: number
  progress: SharedValue<number>
}) {
  const x = (day / 6) * chartW
  const style = useAnimatedStyle(() => {
    const current = Math.min(6, Math.max(0, Math.floor(progress.value)))
    const isCurrent = current === day
    return {
      color: isCurrent ? '#fafafa' : '#52525b',
    } as any
  })
  return (
    <Animated.Text
      style={[
        {
          position: 'absolute',
          left: x - 6,
          width: 12,
          textAlign: 'center',
          fontSize: 11,
          fontWeight: '600',
        },
        style,
      ]}
    >
      {label}
    </Animated.Text>
  )
}

// ─── Worklets + helpers (pure, JS+UI thread safe) ───────────────────────────

/**
 * Build the SVG path for `cum` (length-7 cumulative kg) revealed up to
 * fractional `progress` (0..7). Runs on the UI thread per frame.
 */
function buildPath(
  cum: number[],
  progress: number,
  chartW: number,
  chartH: number,
  yMax: number,
): string {
  'worklet'
  const N = cum.length // 7
  if (N === 0 || yMax === 0) return ''
  const stepX = chartW / (N - 1)
  const floor = Math.min(N - 1, Math.max(0, Math.floor(progress)))
  const frac = Math.min(1, Math.max(0, progress - floor))

  let d = ''
  for (let i = 0; i <= floor; i++) {
    const x = PAD.left + i * stepX
    const y = PAD.top + chartH - (cum[i] / yMax) * chartH
    d += i === 0 ? `M${x},${y}` : ` L${x},${y}`
  }

  // Fractional last segment so the line smoothly extends as progress advances.
  if (floor < N - 1 && frac > 0) {
    const x = PAD.left + (floor + frac) * stepX
    const y0 = cum[floor]
    const y1 = cum[floor + 1]
    const yInterp = y0 + (y1 - y0) * frac
    const y = PAD.top + chartH - (yInterp / yMax) * chartH
    d += ` L${x},${y}`
  }

  return d
}

/**
 * Current (x, y) endpoint of the line for `cum` at fractional `progress`.
 * Used by the marker to track the line tip.
 */
function pointAt(
  cum: number[],
  progress: number,
  chartW: number,
  chartH: number,
  yMax: number,
): { x: number; y: number } {
  'worklet'
  const N = cum.length
  if (N === 0 || yMax === 0) return { x: 0, y: 0 }
  const stepX = chartW / (N - 1)
  const floor = Math.min(N - 1, Math.max(0, Math.floor(progress)))
  const frac = Math.min(1, Math.max(0, progress - floor))

  if (floor >= N - 1) {
    const x = (N - 1) * stepX
    const y = chartH - (cum[N - 1] / yMax) * chartH
    return { x, y }
  }
  const x = (floor + frac) * stepX
  const y0 = cum[floor]
  const y1 = cum[floor + 1]
  const yInterp = y0 + (y1 - y0) * frac
  const y = chartH - (yInterp / yMax) * chartH
  return { x, y }
}

/** Worklet-safe array membership check (no Array.prototype.includes on UI thread). */
function isIn(arr: string[], id: string): boolean {
  'worklet'
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === id) return true
  }
  return false
}

/**
 * For each day d (0..6), compute the list of user_ids in the top N by
 * cumulative kg through end of day d. JS-thread work, memoized in the parent.
 */
function computeVisibilityByDay(crew: RecapCrewMember[]): string[][] {
  const result: string[][] = []
  for (let d = 0; d < 7; d++) {
    const ranked = crew
      .map((m) => ({ id: m.user_id, kg: m.daily_cumulative_kg[d] ?? 0 }))
      .sort((a, b) => b.kg - a.kg)
    result.push(ranked.slice(0, TOP_N_VISIBLE).map((r) => r.id))
  }
  return result
}
