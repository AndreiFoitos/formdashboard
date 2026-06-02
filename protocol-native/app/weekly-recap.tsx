import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { StatusBar } from 'expo-status-bar'
import { router } from 'expo-router'
import { RotateCcw, X } from 'lucide-react-native'
import { api } from '../api/client'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { hapticLight } from '../lib/haptics'
import { RaceCanvas } from '../components/recap/RaceCanvas'
import { PodiumCanvas } from '../components/recap/PodiumCanvas'
import { RACE_DURATION_MS } from '../components/recap/recapShared'

// ─── Types (mirror backend /friends/recap/race shape) ───────────────────────

export interface RecapCrewMember {
  user_id: string
  name: string
  username: string | null
  /** Length-7 array, index 0 = Monday, index 6 = Sunday. Cumulative kg. */
  daily_cumulative_kg: number[]
  days_trained: number
  total_kg: number
  is_trusted: boolean
  is_sus: boolean
  /** ISO weekday 1=Mon..7=Sun when the user crossed the threshold for their
   *  end-state badge. Null if no badge earned. */
  trusted_crossed_on_day: number | null
  sus_crossed_on_day: number | null
  is_me: boolean
}

export interface RecapRaceData {
  week_start: string
  week_end: string
  crew: RecapCrewMember[]
}

// ─── State machine ──────────────────────────────────────────────────────────

type Phase = 'idle' | 'intro' | 'race' | 'transition' | 'podium' | 'outro'

// Phase clock. Race timing is shared with RaceCanvas so the line driver and
// this auto-advance never drift. Tightened from the first cut — the race now
// paces 2s/day (was 3.5s) and the bookend beats are trimmed to match.
const PHASE_DURATIONS_MS: Record<Phase, number> = {
  idle: 0,                  // waiting on data
  intro: 1500,
  race: RACE_DURATION_MS,   // 7 days × RACE_PER_DAY_MS (see recapShared)
  transition: 1200,
  podium: 5200,
  outro: 0,                 // user-driven (Replay / Close)
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function WeeklyRecapScreen() {
  const { user } = useRequireAuth()
  const [phase, setPhase] = useState<Phase>('idle')
  // Bumped on Replay so child animations can re-key off it and re-mount.
  const [runId, setRunId] = useState(0)

  const { data, isLoading, error } = useQuery<RecapRaceData>({
    queryKey: ['friends-recap-race', 0],
    queryFn: () => api.get('/friends/recap/race?week_offset=0').then((r) => r.data),
    enabled: !!user,
  })

  // Once we have data, kick the state machine into intro.
  useEffect(() => {
    if (!data || phase !== 'idle') return
    setPhase('intro')
  }, [data, phase])

  // Phase auto-advances. Each phase's timer cleans up on unmount or re-run.
  useEffect(() => {
    if (phase === 'idle' || phase === 'outro') return
    const next: Record<Phase, Phase> = {
      idle: 'idle',
      intro: 'race',
      race: 'transition',
      transition: 'podium',
      podium: 'outro',
      outro: 'outro',
    }
    const t = setTimeout(() => setPhase(next[phase]), PHASE_DURATIONS_MS[phase])
    return () => clearTimeout(t)
  }, [phase, runId])

  function handleReplay() {
    hapticLight()
    setRunId((n) => n + 1)
    setPhase('intro')
  }

  function handleClose() {
    hapticLight()
    router.back()
  }

  // ── Loading / error states ──────────────────────────────────────────────
  if (isLoading || !data) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <StatusBar hidden />
        <ActivityIndicator color="#a1a1aa" />
        <Text className="text-zinc-500 text-xs mt-3">Loading the week…</Text>
        <CloseButton onPress={handleClose} />
      </View>
    )
  }

  if (error) {
    return (
      <View className="flex-1 bg-black items-center justify-center px-6">
        <StatusBar hidden />
        <Text className="text-white text-base font-semibold">Couldn't load recap</Text>
        <Text className="text-zinc-500 text-xs mt-2 text-center">
          {(error as Error).message ?? 'Try again in a moment.'}
        </Text>
        <CloseButton onPress={handleClose} />
      </View>
    )
  }

  // ── Main canvas ─────────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-black">
      <StatusBar hidden />

      {/* Phase content — each is a placeholder until task #11/#12 fills them in. */}
      {phase === 'intro' && <IntroScene data={data} />}
      {(phase === 'race' || phase === 'transition') && (
        <RaceScene data={data} phase={phase} runId={runId} />
      )}
      {(phase === 'podium' || phase === 'outro') && (
        <PodiumScene data={data} phase={phase} runId={runId} />
      )}

      <CloseButton onPress={handleClose} />

      {phase === 'outro' && <ReplayButton onPress={handleReplay} />}
    </View>
  )
}

// ─── Phase placeholders ─────────────────────────────────────────────────────
// Filled in by tasks #11 (RaceScene) and #12 (PodiumScene). IntroScene is
// minimal — just the week label fading in/out.

function IntroScene({ data }: { data: RecapRaceData }) {
  const label = formatWeekLabel(data.week_start, data.week_end)
  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-zinc-500 text-xs uppercase tracking-[3px] mb-3">
        Weekly Race
      </Text>
      <Text className="text-white text-2xl font-bold text-center">{label}</Text>
      <Text className="text-zinc-500 text-sm mt-3">
        Crew of {data.crew.length}
      </Text>
    </View>
  )
}

function RaceScene({
  data,
  phase,
  runId,
}: {
  data: RecapRaceData
  phase: Phase
  runId: number
}) {
  const { width, height } = useWindowDimensions()
  // Reserve room for week label at top and day labels/replay button at bottom.
  const canvasH = Math.min(height * 0.62, 520)
  const weekLabel = formatWeekLabel(data.week_start, data.week_end)

  return (
    <View className="flex-1 justify-center">
      <View className="items-center px-6 mb-4">
        <Text className="text-zinc-500 text-[10px] uppercase tracking-[3px]">
          Weekly Race
        </Text>
        <Text className="text-white text-base font-semibold mt-1">{weekLabel}</Text>
      </View>
      <RaceCanvas
        crew={data.crew}
        width={width}
        height={canvasH}
        runId={runId}
      />
      {phase === 'transition' && (
        <View className="items-center mt-6">
          <Text className="text-zinc-500 text-xs uppercase tracking-widest">
            Tallying podium…
          </Text>
        </View>
      )}
    </View>
  )
}

function PodiumScene({
  data,
  phase,
  runId,
}: {
  data: RecapRaceData
  phase: Phase
  runId: number
}) {
  return (
    <View className="flex-1">
      <View className="items-center pt-16 pb-1">
        <Text className="text-zinc-500 text-[10px] uppercase tracking-[3px]">
          Final Standings
        </Text>
        <Text className="text-white text-base font-semibold mt-1">
          {formatWeekLabel(data.week_start, data.week_end)}
        </Text>
      </View>
      <PodiumCanvas crew={data.crew} runId={runId} />
      {phase === 'outro' && (
        <Text className="text-zinc-600 text-xs text-center mb-24">
          Tap replay to watch again
        </Text>
      )}
    </View>
  )
}

// ─── Controls ───────────────────────────────────────────────────────────────

function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={12}
      className="absolute top-12 right-5"
    >
      <X size={22} color="#a1a1aa" strokeWidth={2} />
    </TouchableOpacity>
  )
}

function ReplayButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={12}
      className="absolute bottom-12 self-center flex-row items-center gap-2 px-5 py-3 rounded-full"
      style={{ backgroundColor: '#18181b', borderWidth: 1, borderColor: '#3f3f46' }}
    >
      <RotateCcw size={16} color="#fafafa" strokeWidth={2} />
      <Text className="text-white text-sm font-semibold">Replay</Text>
    </TouchableOpacity>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatWeekLabel(startISO: string, endISO: string): string {
  // "Nov 24 — Dec 1" style, compact and human.
  const start = new Date(startISO + 'T00:00:00')
  const end = new Date(endISO + 'T00:00:00')
  const sm = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const em = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${sm} — ${em}`
}
