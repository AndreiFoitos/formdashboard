import { useState } from 'react'
import { ActivityIndicator, Dimensions, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Lock } from 'lucide-react-native'
import Svg, { Line, Polyline, Rect } from 'react-native-svg'
import { api } from '../api/client'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { openPaywall, usePlan } from '../hooks/usePlan'

interface Point {
  date: string
  value: number
}
interface WeekPoint {
  week: string
  value: number
  sessions: number
}
interface Trends {
  days: number
  capped: boolean
  plan_max_days: number
  form_score: Point[]
  weight_kg: Point[]
  body_fat_pct: Point[]
  volume_weekly: WeekPoint[]
  protein_g: Point[]
}

const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
]

const CHART_W = Dimensions.get('window').width - 64
const CHART_H = 120

function LineChart({ points, color }: { points: Point[]; color: string }) {
  if (points.length < 2) {
    return <Text className="text-zinc-600 text-xs py-8 text-center">Not enough data yet.</Text>
  }
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = CHART_W / (points.length - 1)
  const coords = points
    .map((p, i) => `${(i * step).toFixed(1)},${(CHART_H - ((p.value - min) / span) * CHART_H).toFixed(1)}`)
    .join(' ')

  return (
    <View>
      <Svg width={CHART_W} height={CHART_H}>
        <Line x1={0} y1={CHART_H} x2={CHART_W} y2={CHART_H} stroke="#27272a" strokeWidth={1} />
        <Polyline points={coords} fill="none" stroke={color} strokeWidth={2} />
      </Svg>
      <View className="flex-row justify-between mt-1">
        <Text className="text-zinc-600 text-[10px]">{fmtDate(points[0].date)}</Text>
        <Text className="text-zinc-600 text-[10px]">{fmtDate(points[points.length - 1].date)}</Text>
      </View>
    </View>
  )
}

function BarChart({ points }: { points: WeekPoint[] }) {
  if (points.length === 0) {
    return <Text className="text-zinc-600 text-xs py-8 text-center">No training logged yet.</Text>
  }
  const max = Math.max(...points.map((p) => p.value)) || 1
  const gap = 3
  const barW = Math.max(2, CHART_W / points.length - gap)
  return (
    <View>
      <Svg width={CHART_W} height={CHART_H}>
        {points.map((p, i) => {
          const h = (p.value / max) * CHART_H
          return (
            <Rect
              key={p.week}
              x={i * (barW + gap)}
              y={CHART_H - h}
              width={barW}
              height={h}
              rx={2}
              fill="#facc15"
            />
          )
        })}
      </Svg>
      <View className="flex-row justify-between mt-1">
        <Text className="text-zinc-600 text-[10px]">{points[0].week}</Text>
        <Text className="text-zinc-600 text-[10px]">{points[points.length - 1].week}</Text>
      </View>
    </View>
  )
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function change(points: Point[]): string | null {
  if (points.length < 2) return null
  const diff = points[points.length - 1].value - points[0].value
  if (Math.abs(diff) < 0.05) return 'no change'
  return `${diff > 0 ? '+' : ''}${Math.round(diff * 10) / 10} over this range`
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string | null
  children: React.ReactNode
}) {
  return (
    <View className="bg-zinc-900 rounded-2xl p-4">
      <Text className="text-white text-base font-semibold">{title}</Text>
      {subtitle && <Text className="text-zinc-500 text-xs mt-0.5 mb-2">{subtitle}</Text>}
      <View className="mt-2">{children}</View>
    </View>
  )
}

export default function TrendsScreen() {
  useRequireAuth()
  const { data: plan } = usePlan()
  const maxDays = plan?.history_days ?? 30
  const [days, setDays] = useState(30)

  const { data, isLoading } = useQuery<Trends>({
    queryKey: ['trends', days],
    queryFn: () => api.get(`/dashboard/trends?days=${days}`).then((r) => r.data),
  })

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <View className="flex-row items-center px-4 pt-2 pb-4">
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={12}
          className="-ml-1 pr-4 py-2 flex-row items-center"
          style={{ gap: 2 }}
        >
          <ChevronLeft size={22} color="#d4d4d8" strokeWidth={2.25} />
          <Text className="text-zinc-300 text-base font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold">Trends</Text>
      </View>

      {/* Range picker — ranges beyond the plan open the paywall */}
      <View className="flex-row px-4" style={{ gap: 8 }}>
        {RANGES.map((r) => {
          const locked = r.days > maxDays
          const active = days === r.days
          return (
            <TouchableOpacity
              key={r.days}
              onPress={() => (locked ? openPaywall('history') : setDays(r.days))}
              className="flex-1 rounded-xl py-2.5 items-center flex-row justify-center"
              style={{ gap: 6, backgroundColor: active ? '#27272a' : '#0f0f11' }}
            >
              {locked && <Lock size={12} color="#71717a" />}
              <Text className="text-sm font-medium" style={{ color: locked ? '#71717a' : '#ffffff' }}>
                {r.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingTop: 16, paddingBottom: 40, gap: 14 }}>
        {isLoading || !data ? (
          <ActivityIndicator color="#ffffff" className="mt-10" />
        ) : (
          <>
            <Card title="Form Score" subtitle={change(data.form_score)}>
              <LineChart points={data.form_score} color="#4ade80" />
            </Card>
            <Card title="Body weight (kg)" subtitle={change(data.weight_kg)}>
              <LineChart points={data.weight_kg} color="#60a5fa" />
            </Card>
            {data.body_fat_pct.length > 1 && (
              <Card title="Body fat (%)" subtitle={change(data.body_fat_pct)}>
                <LineChart points={data.body_fat_pct} color="#f472b6" />
              </Card>
            )}
            <Card
              title="Weekly volume (kg moved)"
              subtitle={`${data.volume_weekly.length} weeks with training`}
            >
              <BarChart points={data.volume_weekly} />
            </Card>
            <Card title="Protein (g/day)" subtitle={change(data.protein_g)}>
              <LineChart points={data.protein_g} color="#fbbf24" />
            </Card>

            {maxDays < 365 && (
              <TouchableOpacity
                onPress={() => openPaywall('history')}
                className="bg-zinc-900 rounded-2xl p-4 flex-row items-center justify-between"
              >
                <Text className="text-zinc-300 text-sm flex-1 pr-3">
                  You can look back {maxDays} days. Plus sees 90, Pro sees a full year.
                </Text>
                <Text className="text-yellow-400 text-sm font-semibold">Upgrade ›</Text>
              </TouchableOpacity>
            )}
            <Text className="text-zinc-600 text-xs">
              Your logs themselves are never hidden — only these long-range charts depend on your plan.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
