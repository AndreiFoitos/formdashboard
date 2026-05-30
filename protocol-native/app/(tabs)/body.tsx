import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Dimensions,
} from 'react-native'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Polyline, Line, Text as SvgText, Circle } from 'react-native-svg'
import { api } from '../../api/client'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { useAuthStore } from '../../store/auth'
import { CountUp } from '../../components/CountUp'
import { SkeletonCard } from '../../components/Skeleton'
import { SwipeableRow } from '../../components/SwipeableRow'
import { PressableScale } from '../../components/PressableScale'
import { hapticSuccess, hapticSelection } from '../../lib/haptics'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BodyMetric {
  id: string
  date: string
  weight_kg: number | null
  body_fat_pct: number | null
  source: string
  logged_at: string
}

interface BodyStats {
  current_weight_kg: number | null
  current_body_fat_pct: number | null
  weight_change_7d: number | null
  weight_change_30d: number | null
  bf_change_7d: number | null
  bf_change_30d: number | null
  lowest_weight_kg: number | null
  highest_weight_kg: number | null
  total_entries: number
}

interface BodyHistory {
  entries: BodyMetric[]
  stats: BodyStats | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDateFull(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function trendInfo(change: number | null, isWeight = true) {
  if (change === null) return null
  const abs = Math.abs(change)
  const threshold = isWeight ? 0.05 : 0.1
  if (abs < threshold) return { arrow: '→', color: '#71717a', label: 'stable' }
  const up = change > 0
  return {
    arrow: up ? '↑' : '↓',
    color: up ? '#f97316' : '#22c55e',
    label: isWeight
      ? `${up ? '+' : ''}${change.toFixed(1)} kg`
      : `${up ? '+' : ''}${change.toFixed(1)}%`,
  }
}

// ─── SVG Line Chart (replaces victory-native) ────────────────────────────────

function MetricChart({
  entries,
  field,
  color,
  label,
}: {
  entries: BodyMetric[]
  field: 'weight_kg' | 'body_fat_pct'
  color: string
  label: string
}) {
  const data = entries
    .filter((e) => e[field] != null)
    .map((e) => ({ date: formatDate(e.date), value: e[field] as number }))

  if (data.length < 2) {
    return (
      <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1">
          {label} trend
        </Text>
        <View style={{ height: 80, alignItems: 'center', justifyContent: 'center' }}>
          <Text className="text-zinc-600 text-xs">Log at least 2 entries to see a chart</Text>
        </View>
      </View>
    )
  }

  const screenWidth = Dimensions.get('window').width
  const chartWidth = screenWidth - 64 // 16px padding each side + 16px card padding each side
  const chartHeight = 110
  const paddingLeft = 36
  const paddingRight = 8
  const paddingTop = 8
  const paddingBottom = 24

  const plotW = chartWidth - paddingLeft - paddingRight
  const plotH = chartHeight - paddingTop - paddingBottom

  const values = data.map((d) => d.value)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const range = maxV - minV || 1
  const pad = range * 0.15

  const toX = (i: number) => paddingLeft + (i / (data.length - 1)) * plotW
  const toY = (v: number) =>
    paddingTop + plotH - ((v - (minV - pad)) / (range + pad * 2)) * plotH

  const points = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ')

  // Tick labels: show up to 5 evenly spaced
  const tickStep = Math.max(1, Math.floor(data.length / 4))
  const tickIndices = Array.from({ length: data.length }, (_, i) => i).filter(
    (i) => i % tickStep === 0 || i === data.length - 1,
  )

  // Y-axis: 3 reference values
  const yTicks = [minV - pad, (minV + maxV) / 2, maxV + pad]

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-3">
        {label} trend
      </Text>
      <Svg width={chartWidth} height={chartHeight}>
        {/* Grid lines */}
        {yTicks.map((v, i) => (
          <Line
            key={i}
            x1={paddingLeft}
            y1={toY(v)}
            x2={chartWidth - paddingRight}
            y2={toY(v)}
            stroke="#27272a"
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        ))}

        {/* Y-axis labels */}
        {yTicks.map((v, i) => (
          <SvgText
            key={i}
            x={paddingLeft - 4}
            y={toY(v) + 4}
            fontSize={8}
            fill="#52525b"
            textAnchor="end"
          >
            {v.toFixed(1)}
          </SvgText>
        ))}

        {/* Line */}
        <Polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dots (only when few points) */}
        {data.length <= 15 &&
          data.map((d, i) => (
            <Circle
              key={i}
              cx={toX(i)}
              cy={toY(d.value)}
              r={3}
              fill={color}
            />
          ))}

        {/* X-axis labels */}
        {tickIndices.map((i) => (
          <SvgText
            key={i}
            x={toX(i)}
            y={chartHeight - 4}
            fontSize={8}
            fill="#52525b"
            textAnchor="middle"
          >
            {data[i].date}
          </SvgText>
        ))}
      </Svg>
    </View>
  )
}

// ─── Trend Card ───────────────────────────────────────────────────────────────

function TrendCard({
  label,
  value,
  unit,
  change7d,
  change30d,
  isWeight = true,
}: {
  label: string
  value: number | null
  unit: string
  change7d: number | null
  change30d: number | null
  isWeight?: boolean
}) {
  const t7 = trendInfo(change7d, isWeight)
  const t30 = trendInfo(change30d, isWeight)

  return (
    <View className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
        {label}
      </Text>
      <Text className="text-white text-2xl font-bold mb-3">
        {value != null ? (
          <CountUp value={value} decimals={1} className="text-white text-2xl font-bold" />
        ) : (
          '—'
        )}
        <Text className="text-zinc-500 text-sm font-normal"> {unit}</Text>
      </Text>
      <View className="flex-row gap-4">
        {t7 && (
          <View>
            <Text className="text-zinc-600 text-xs mb-0.5">7d</Text>
            <Text className="text-xs font-semibold" style={{ color: t7.color }}>
              {t7.arrow} {t7.label}
            </Text>
          </View>
        )}
        {t30 && (
          <View>
            <Text className="text-zinc-600 text-xs mb-0.5">30d</Text>
            <Text className="text-xs font-semibold" style={{ color: t30.color }}>
              {t30.arrow} {t30.label}
            </Text>
          </View>
        )}
        {!t7 && !t30 && (
          <Text className="text-zinc-600 text-xs">Log more to see trends</Text>
        )}
      </View>
    </View>
  )
}

// ─── Log Modal ────────────────────────────────────────────────────────────────

function LogModal({
  onClose,
  currentWeight,
}: {
  onClose: () => void
  currentWeight: number | null
}) {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const [weight, setWeight] = useState(currentWeight ? currentWeight.toFixed(1) : '')
  const [bodyFat, setBodyFat] = useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: (body: object) => api.post('/body/metrics', body),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['body-history'] })
      onClose()
    },
  })

  const hasValue = weight || bodyFat

  const bmiVal =
    weight && user?.height_cm
      ? (parseFloat(weight) / Math.pow(user.height_cm / 100, 2)).toFixed(1)
      : null

  function handleLog() {
    const payload: { weight_kg?: number; body_fat_pct?: number } = {}
    if (weight) payload.weight_kg = parseFloat(weight)
    if (bodyFat) payload.body_fat_pct = parseFloat(bodyFat)
    if (!payload.weight_kg && !payload.body_fat_pct) return
    mutate(payload)
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-zinc-950">
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 bg-zinc-700 rounded-full" />
        </View>

        <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-800">
          <Text className="text-white font-semibold">Log Body Metrics</Text>
          <TouchableOpacity onPress={onClose}>
            <Text className="text-zinc-400 text-sm">✕</Text>
          </TouchableOpacity>
        </View>

        <View className="px-4 pt-6" style={{ gap: 16 }}>
          {/* Weight */}
          <View>
            <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1.5">
              Weight
            </Text>
            <View>
              <TextInput
                value={weight}
                onChangeText={(t) => setWeight(t.replace(',', '.'))}
                placeholder={currentWeight ? currentWeight.toFixed(1) : '80.0'}
                placeholderTextColor="#52525b"
                keyboardType="decimal-pad"
                className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm"
              />
              <Text className="absolute right-4 top-4 text-zinc-500 text-sm">kg</Text>
            </View>
            {bmiVal && (
              <Text className="text-zinc-600 text-xs mt-1.5">BMI: {bmiVal}</Text>
            )}
          </View>

          {/* Body Fat */}
          <View>
            <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1.5">
              Body Fat{' '}
              <Text className="text-zinc-700 normal-case">(optional)</Text>
            </Text>
            <View>
              <TextInput
                value={bodyFat}
                onChangeText={(t) => setBodyFat(t.replace(',', '.'))}
                placeholder="15.0"
                placeholderTextColor="#52525b"
                keyboardType="decimal-pad"
                className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm"
              />
              <Text className="absolute right-4 top-4 text-zinc-500 text-sm">%</Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={handleLog}
            disabled={!hasValue || isPending}
            className="bg-white rounded-2xl py-4 items-center"
            style={{ opacity: !hasValue || isPending ? 0.4 : 1 }}
          >
            {isPending ? (
              <ActivityIndicator color="black" />
            ) : (
              <Text className="text-black font-semibold text-base">Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

// ─── History Row ──────────────────────────────────────────────────────────────

function HistoryRow({
  metric,
  isLast,
}: {
  metric: BodyMetric
  isLast: boolean
}) {
  return (
    <View
      className="flex-row items-center px-4 py-4 bg-zinc-900"
      style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#27272a' }}
    >
      <View className="flex-1">
        <Text className="text-zinc-500 text-xs">{formatDateFull(metric.date)}</Text>
        <View className="flex-row gap-4 mt-0.5">
          {metric.weight_kg != null && (
            <Text className="text-white text-sm font-semibold">
              {metric.weight_kg.toFixed(1)}
              <Text className="text-zinc-500 text-xs font-normal"> kg</Text>
            </Text>
          )}
          {metric.body_fat_pct != null && (
            <Text className="text-white text-sm font-semibold">
              {metric.body_fat_pct.toFixed(1)}
              <Text className="text-zinc-500 text-xs font-normal"> % BF</Text>
            </Text>
          )}
        </View>
      </View>
    </View>
  )
}

// ─── Body Screen ──────────────────────────────────────────────────────────────

export default function BodyScreen() {
  const { user } = useRequireAuth()
  const [showLog, setShowLog] = useState(false)
  const [range, setRange] = useState<30 | 60 | 90>(90)
  const qc = useQueryClient()

  const { data, isLoading, refetch, isRefetching } = useQuery<BodyHistory>({
    queryKey: ['body-history', range],
    queryFn: () => api.get(`/body/history?days=${range}`).then((r) => r.data),
    enabled: !!user,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/body/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['body-history'] }),
  })

  const entries = data?.entries ?? []
  const stats = data?.stats ?? null
  const hasWeight = entries.some((e) => e.weight_kg != null)
  const hasBF = entries.some((e) => e.body_fat_pct != null)

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#ffffff"
          />
        }
      >
        {/* Header */}
        <View className="pt-6 pb-5 flex-row items-end justify-between">
          <View>
            <Text className="text-zinc-500 text-xs uppercase tracking-widest">{today}</Text>
            <Text className="text-white text-2xl font-bold mt-1">Body</Text>
          </View>
          <PressableScale
            haptic
            onPress={() => setShowLog(true)}
            className="bg-white px-4 py-2 rounded-2xl"
          >
            <Text className="text-black text-sm font-semibold">+ Log</Text>
          </PressableScale>
        </View>

        {isLoading ? (
          <View style={{ gap: 12, marginTop: 4 }}>
            <View className="flex-row gap-3">
              <View className="flex-1"><SkeletonCard height={96} /></View>
              <View className="flex-1"><SkeletonCard height={96} /></View>
            </View>
            <SkeletonCard height={140} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {/* Trend cards */}
            {stats && (
              <View className="flex-row gap-3">
                <TrendCard
                  label="Weight"
                  value={stats.current_weight_kg}
                  unit="kg"
                  change7d={stats.weight_change_7d}
                  change30d={stats.weight_change_30d}
                  isWeight
                />
                <TrendCard
                  label="Body Fat"
                  value={stats.current_body_fat_pct}
                  unit="%"
                  change7d={stats.bf_change_7d}
                  change30d={stats.bf_change_30d}
                  isWeight={false}
                />
              </View>
            )}

            {/* Empty state */}
            {entries.length === 0 && (
              <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 items-center">
                <Text className="text-zinc-400 text-sm font-medium">
                  No body metrics yet
                </Text>
                <Text className="text-zinc-600 text-xs mt-1 mb-4 text-center">
                  Track your weight and body fat to see trends over time
                </Text>
                <TouchableOpacity
                  onPress={() => setShowLog(true)}
                  className="bg-zinc-800 px-4 py-2 rounded-2xl"
                >
                  <Text className="text-white text-sm font-medium">
                    Log your first entry →
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {entries.length > 0 && (
              <>
                {/* Range selector */}
                <View className="flex-row items-center justify-between">
                  <Text className="text-zinc-500 text-xs">
                    {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                  </Text>
                  <View className="flex-row gap-1.5">
                    {([30, 60, 90] as const).map((r) => (
                      <TouchableOpacity
                        key={r}
                        onPress={() => { hapticSelection(); setRange(r) }}
                        className="px-3 py-1.5 rounded-xl border"
                        style={{
                          backgroundColor: range === r ? 'white' : '#18181b',
                          borderColor: range === r ? 'white' : '#3f3f46',
                        }}
                      >
                        <Text
                          className="text-xs font-medium"
                          style={{ color: range === r ? 'black' : '#71717a' }}
                        >
                          {r}d
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {hasWeight && (
                  <MetricChart
                    entries={entries}
                    field="weight_kg"
                    color="#ffffff"
                    label="Weight"
                  />
                )}

                {hasBF && (
                  <MetricChart
                    entries={entries}
                    field="body_fat_pct"
                    color="#a78bfa"
                    label="Body Fat"
                  />
                )}

                {/* Range stats */}
                {stats?.lowest_weight_kg != null && (
                  <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                    <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-3">
                      {range}-day range
                    </Text>
                    <View className="flex-row gap-6">
                      <View>
                        <Text className="text-zinc-600 text-xs mb-0.5">Low</Text>
                        <Text className="text-white text-sm font-semibold">
                          {stats.lowest_weight_kg?.toFixed(1)}
                          <Text className="text-zinc-500 text-xs font-normal"> kg</Text>
                        </Text>
                      </View>
                      <View>
                        <Text className="text-zinc-600 text-xs mb-0.5">High</Text>
                        <Text className="text-white text-sm font-semibold">
                          {stats.highest_weight_kg?.toFixed(1)}
                          <Text className="text-zinc-500 text-xs font-normal"> kg</Text>
                        </Text>
                      </View>
                      {stats.highest_weight_kg != null && stats.lowest_weight_kg != null && (
                        <View>
                          <Text className="text-zinc-600 text-xs mb-0.5">Variance</Text>
                          <Text className="text-white text-sm font-semibold">
                            {(stats.highest_weight_kg - stats.lowest_weight_kg).toFixed(1)}
                            <Text className="text-zinc-500 text-xs font-normal"> kg</Text>
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}

                {/* History list */}
                <Text className="text-zinc-500 text-xs uppercase tracking-widest">
                  History
                </Text>
                <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                  {[...entries].reverse().map((metric, i) => (
                    <SwipeableRow
                      key={metric.id}
                      onDelete={() => deleteMutation.mutate(metric.id)}
                    >
                      <HistoryRow metric={metric} isLast={i === entries.length - 1} />
                    </SwipeableRow>
                  ))}
                </View>
              </>
            )}
          </View>
        )}
      </ScrollView>

      {showLog && (
        <LogModal
          onClose={() => setShowLog(false)}
          currentWeight={stats?.current_weight_kg ?? null}
        />
      )}
    </SafeAreaView>
  )
}