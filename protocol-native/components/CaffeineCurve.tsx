import { useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  TextInput,
} from 'react-native'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Svg, {
  Polyline,
  Line,
  Defs,
  LinearGradient,
  Stop,
  Polygon,
  Text as SvgText,
} from 'react-native-svg'
import { api } from '../api/client'
import { showUndo } from '../store/undo'
import { hapticLight, hapticSuccess } from '../lib/haptics'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CurvePoint {
  time: string
  time_label: string
  caffeine_mg: number
  in_past: boolean
  zone: 'low' | 'optimal' | 'elevated' | 'high'
}

export interface CurveData {
  curve: CurvePoint[]
  current_mg: number
  caffeine_at_bedtime: number
  sleep_impact: string
  total_today_mg: number
  last_log: {
    substance: string
    label: string
    caffeine_mg: number
    additions: string[]
  } | null
}

interface Substance {
  key: string
  label: string
  caffeine_mg: number
  half_life: number
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  serving: string
  supports_additions: boolean
}

interface Addition {
  key: string
  label: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

interface SubstancesPayload {
  substances: Substance[]
  additions: Addition[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function zoneColour(mg: number) {
  if (mg < 50)  return '#52525b'
  if (mg < 200) return '#22c55e'
  if (mg < 300) return '#f59e0b'
  return '#ef4444'
}

function zoneLabel(mg: number) {
  if (mg < 50)  return 'low'
  if (mg < 200) return 'optimal'
  if (mg < 300) return 'elevated'
  return 'high'
}

// ─── SVG Caffeine Chart ───────────────────────────────────────────────────────

function CaffeineChart({ curve, colour }: { curve: CurvePoint[]; colour: string }) {
  const screenWidth = Dimensions.get('window').width
  const chartWidth = screenWidth - 64 // card padding
  const chartHeight = 132
  const paddingLeft = 30 // room for mg labels on the y-axis
  const paddingRight = 6
  const paddingTop = 8
  const paddingBottom = 22 // room for time labels on the x-axis

  const plotW = chartWidth - paddingLeft - paddingRight
  const plotH = chartHeight - paddingTop - paddingBottom

  const values = curve.map((p) => p.caffeine_mg)
  const maxV = Math.max(...values, 10)

  const toX = (i: number) =>
    paddingLeft + (i / (curve.length - 1)) * plotW

  const toY = (v: number) =>
    paddingTop + plotH - (v / maxV) * plotH

  // Build area polygon (line + bottom close)
  const linePoints = curve.map((p, i) => `${toX(i)},${toY(p.caffeine_mg)}`).join(' ')
  const areaPoints =
    `${paddingLeft},${paddingTop + plotH} ` +
    linePoints +
    ` ${chartWidth - paddingRight},${paddingTop + plotH}`

  // Now-line index
  const nowIdx = curve.findIndex((p) => !p.in_past)

  // X-axis time labels — every 4 hours. Curve steps are 30 min starting
  // at 6 AM, so every 4h = every 8 indexes. Strip ":00" for compactness.
  const xLabels: { i: number; label: string }[] = []
  for (let i = 0; i < curve.length; i += 8) {
    xLabels.push({ i, label: curve[i].time_label.replace(':00 ', ' ') })
  }

  // Threshold reference lines (50 / 200 / 300 mg) keep their colour coding.
  const refLines = [50, 200, 300].filter((v) => v < maxV * 1.1)

  // Y-axis tick values — every 50 mg up to the chart's max.
  const yTicks: number[] = []
  for (let v = 0; v <= maxV; v += 50) yTicks.push(v)

  return (
    <Svg width={chartWidth} height={chartHeight}>
      <Defs>
        <LinearGradient id="cafGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={colour} stopOpacity={0.25} />
          <Stop offset="100%" stopColor={colour} stopOpacity={0} />
        </LinearGradient>
      </Defs>

      {/* Reference lines */}
      {refLines.map((v) => (
        <Line
          key={v}
          x1={paddingLeft}
          y1={toY(v)}
          x2={chartWidth - paddingRight}
          y2={toY(v)}
          stroke={v === 50 ? '#3f3f46' : v === 200 ? '#f59e0b' : '#ef4444'}
          strokeWidth={1}
          strokeDasharray="3,3"
          opacity={0.6}
        />
      ))}

      {/* Y-axis labels */}
      {yTicks.map((v) => (
        <SvgText
          key={`y-${v}`}
          x={paddingLeft - 6}
          y={toY(v) + 3}
          fontSize={9}
          fill="#71717a"
          textAnchor="end"
        >
          {v}
        </SvgText>
      ))}

      {/* Area fill */}
      <Polygon points={areaPoints} fill="url(#cafGrad)" />

      {/* Line */}
      <Polyline
        points={linePoints}
        fill="none"
        stroke={colour}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Now reference line */}
      {nowIdx > 0 && nowIdx < curve.length && (
        <Line
          x1={toX(nowIdx)}
          y1={paddingTop}
          x2={toX(nowIdx)}
          y2={paddingTop + plotH}
          stroke="#ffffff"
          strokeWidth={1}
          strokeDasharray="4,2"
          opacity={0.4}
        />
      )}

      {/* X-axis labels */}
      {xLabels.map(({ i, label }) => (
        <SvgText
          key={`x-${i}`}
          x={toX(i)}
          y={paddingTop + plotH + 14}
          fontSize={9}
          fill="#71717a"
          textAnchor={i === 0 ? 'start' : 'middle'}
        >
          {label}
        </SvgText>
      ))}
    </Svg>
  )
}

// ─── Log Modal ────────────────────────────────────────────────────────────────

function LogModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [customMg, setCustomMg] = useState('')
  const [pickedAdditions, setPickedAdditions] = useState<string[]>([])

  const { data: payload } = useQuery<SubstancesPayload>({
    queryKey: ['substances'],
    queryFn: () => api.get('/stimulants/substances').then((r) => r.data),
    staleTime: Infinity,
  })
  const substances = payload?.substances ?? []
  const additions = payload?.additions ?? []

  const { mutateAsync, isPending } = useMutation({
    mutationFn: (body: { substance: string; caffeine_mg?: number; additions: string[] }) =>
      api
        .post('/stimulants/log', body)
        .then((r) => r.data as {
          id: string
          substance: string
          caffeine_mg: number
          calories: number
        }),
  })

  function toggleAddition(key: string) {
    setPickedAdditions((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }

  // When the selected substance changes, reset add-ons (they only apply to
  // whichever drink is currently selected).
  function selectSubstance(key: string) {
    setSelected(key)
    setPickedAdditions([])
  }

  async function handleLog() {
    if (!selected) return
    const body: { substance: string; caffeine_mg?: number; additions: string[] } = {
      substance: selected,
      additions: pickedAdditions,
    }
    if (selected === 'custom' && customMg) {
      body.caffeine_mg = parseInt(customMg)
    }
    try {
      const entry = await mutateAsync(body)
      const presetForLabel = substances.find((s) => s.key === selected)
      const label = presetForLabel?.label ?? 'Stimulant'
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
      showUndo({
        label: `+${label} · ${entry.caffeine_mg}mg`,
        onUndo: async () => {
          await api.delete(`/stimulants/${entry.id}`)
          qc.invalidateQueries({ queryKey: ['dashboard'] })
        },
      })
    } catch {
      // Mutation errors fall through silently; modal stays open.
    }
  }

  const presets = substances.filter((s) => s.key !== 'custom')
  const selectedSubstance = substances.find((s) => s.key === selected)
  const showAdditions = selectedSubstance?.supports_additions ?? false

  // Live total: base substance macros + selected add-ons. Recomputed inline
  // since the picker is tiny; if it grows we can memoise.
  const liveTotals = selectedSubstance
    ? pickedAdditions.reduce(
        (acc, k) => {
          const a = additions.find((x) => x.key === k)
          if (!a) return acc
          return {
            calories: acc.calories + a.calories,
            protein_g: acc.protein_g + a.protein_g,
            carbs_g: acc.carbs_g + a.carbs_g,
            fat_g: acc.fat_g + a.fat_g,
          }
        },
        {
          calories: selectedSubstance.calories,
          protein_g: selectedSubstance.protein_g,
          carbs_g: selectedSubstance.carbs_g,
          fat_g: selectedSubstance.fat_g,
        },
      )
    : null

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
          <Text className="text-white font-semibold">Log Stimulant</Text>
          <TouchableOpacity onPress={onClose}>
            <Text className="text-zinc-400 text-sm">✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled">
          <View className="flex-row flex-wrap gap-2 mb-4">
            {presets.map((s) => (
              <TouchableOpacity
                key={s.key}
                onPress={() => selectSubstance(s.key)}
                className="px-4 py-3 rounded-2xl border"
                style={{
                  backgroundColor: selected === s.key ? 'white' : '#18181b',
                  borderColor: selected === s.key ? 'white' : '#3f3f46',
                  width: '47%',
                }}
              >
                <Text
                  className="text-sm font-medium"
                  style={{ color: selected === s.key ? 'black' : 'white' }}
                >
                  {s.label}
                </Text>
                <Text
                  className="text-xs mt-0.5"
                  style={{ color: selected === s.key ? '#52525b' : '#71717a' }}
                >
                  {s.caffeine_mg}mg · {s.calories} kcal
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              onPress={() => selectSubstance('custom')}
              className="px-4 py-3 rounded-2xl border"
              style={{
                backgroundColor: selected === 'custom' ? 'white' : '#18181b',
                borderColor: selected === 'custom' ? 'white' : '#3f3f46',
                width: '47%',
              }}
            >
              <Text
                className="text-sm font-medium"
                style={{ color: selected === 'custom' ? 'black' : 'white' }}
              >
                Custom
              </Text>
              <Text
                className="text-xs mt-0.5"
                style={{ color: selected === 'custom' ? '#52525b' : '#71717a' }}
              >
                Enter mg manually
              </Text>
            </TouchableOpacity>
          </View>

          {selected === 'custom' && (
            <View className="mb-4">
              <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1.5">
                Caffeine (mg)
              </Text>
              <View>
                <TextInput
                  value={customMg}
                  onChangeText={setCustomMg}
                  placeholder="e.g. 150"
                  placeholderTextColor="#52525b"
                  keyboardType="number-pad"
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm"
                />
                <Text className="absolute right-4 top-4 text-zinc-500 text-sm">mg</Text>
              </View>
            </View>
          )}

          {showAdditions && additions.length > 0 && (
            <View className="mb-4">
              <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
                Add-ons
              </Text>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {additions.map((a) => {
                  const active = pickedAdditions.includes(a.key)
                  return (
                    <TouchableOpacity
                      key={a.key}
                      onPress={() => toggleAddition(a.key)}
                      className="px-3 py-2 rounded-full border"
                      style={{
                        backgroundColor: active ? 'white' : '#18181b',
                        borderColor: active ? 'white' : '#3f3f46',
                      }}
                    >
                      <Text
                        className="text-xs font-medium"
                        style={{ color: active ? 'black' : '#d4d4d8' }}
                      >
                        {active ? '✓ ' : '+ '}{a.label} · {a.calories} kcal
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
          )}

          {selectedSubstance && selected !== 'custom' && liveTotals && (
            <View className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 mb-4">
              <Text className="text-zinc-500 text-xs mb-1">
                {selectedSubstance.caffeine_mg}mg caffeine · half-life {selectedSubstance.half_life}h · {selectedSubstance.serving}
              </Text>
              <Text className="text-white text-sm font-semibold">
                {liveTotals.calories} kcal
                <Text className="text-zinc-500 text-xs font-normal">
                  {'  '}· {liveTotals.protein_g.toFixed(1)}p · {liveTotals.carbs_g.toFixed(1)}c · {liveTotals.fat_g.toFixed(1)}f
                </Text>
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={handleLog}
            disabled={!selected || isPending || (selected === 'custom' && !customMg)}
            className="bg-white rounded-2xl py-4 items-center mb-10"
            style={{
              opacity: !selected || isPending || (selected === 'custom' && !customMg) ? 0.4 : 1,
            }}
          >
            {isPending ? (
              <ActivityIndicator color="black" />
            ) : (
              <Text className="text-black font-semibold text-base">Log</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  )
}

// ─── Caffeine Curve Card ──────────────────────────────────────────────────────

interface Props {
  data: CurveData | undefined
  isLoading: boolean
}

export function CaffeineCurve({ data, isLoading }: Props) {
  const [showLog, setShowLog] = useState(false)
  const qc = useQueryClient()

  const { mutateAsync, isPending } = useMutation({
    mutationFn: (body: { substance: string; caffeine_mg?: number; additions: string[] }) =>
      api
        .post('/stimulants/log', body)
        .then((r) => r.data as { id: string; substance: string; caffeine_mg: number }),
  })

  if (isLoading) {
    return (
      <View className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
        <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Caffeine</Text>
        <View style={{ height: 100, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#52525b" />
        </View>
      </View>
    )
  }

  const curve = data?.curve ?? []
  const currentMg = data?.current_mg ?? 0
  const colour = zoneColour(currentMg)
  const last = data?.last_log ?? null

  const handleRepeat = async () => {
    if (!last) return
    hapticLight()
    const body: { substance: string; caffeine_mg?: number; additions: string[] } =
      last.substance === 'custom'
        ? { substance: 'custom', caffeine_mg: last.caffeine_mg, additions: last.additions }
        : { substance: last.substance, additions: last.additions }
    try {
      const entry = await mutateAsync(body)
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      showUndo({
        label: `+${last.label} · ${last.caffeine_mg}mg`,
        onUndo: async () => {
          await api.delete(`/stimulants/${entry.id}`)
          qc.invalidateQueries({ queryKey: ['dashboard'] })
        },
      })
    } catch {
      // Swallow — surface via toast in the future if needed.
    }
  }

  return (
    <>
      <View className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
        {/* Header */}
        <View className="flex-row items-start justify-between mb-3">
          <View className="flex-1">
            <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1">
              Caffeine
            </Text>
            <View className="flex-row items-baseline gap-2">
              <Text className="text-white text-3xl font-bold">{currentMg}</Text>
              <Text className="text-zinc-500 text-sm">mg active</Text>
              <View
                className="px-1.5 py-0.5 rounded-full ml-1"
                style={{ backgroundColor: `${colour}20` }}
              >
                <Text className="text-xs font-medium" style={{ color: colour }}>
                  {zoneLabel(currentMg)}
                </Text>
              </View>
            </View>
          </View>

          {/* Repeat-last chip + overflow into the full picker.
             Long-press on the chip jumps straight to the picker too. */}
          <View className="flex-row items-center gap-2">
            {last ? (
              <TouchableOpacity
                onPress={handleRepeat}
                onLongPress={() => setShowLog(true)}
                disabled={isPending}
                className="bg-zinc-800 px-3 py-1.5 rounded-xl flex-row items-center"
                style={{ opacity: isPending ? 0.5 : 1 }}
              >
                <Text className="text-white text-xs font-semibold">+ {last.label}</Text>
                <Text className="text-zinc-500 text-xs ml-1.5">{last.caffeine_mg}mg</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => setShowLog(true)}
              className="bg-zinc-800 w-8 h-8 rounded-xl items-center justify-center"
              hitSlop={6}
            >
              <Text className="text-zinc-400 text-base">{last ? '⋯' : '+'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Chart */}
        {curve.length > 1 ? (
          <CaffeineChart curve={curve} colour={colour} />
        ) : (
          <View style={{ height: 80, alignItems: 'center', justifyContent: 'center' }}>
            <Text className="text-zinc-600 text-sm">No caffeine logged today</Text>
          </View>
        )}

        {/* Footer */}
        {data && (
          <Text className="text-zinc-500 text-xs leading-5 mt-2">
            {data.sleep_impact}
            {data.caffeine_at_bedtime > 0 && (
              <Text className="text-zinc-600">
                {' '}· {data.caffeine_at_bedtime}mg at bedtime
              </Text>
            )}
          </Text>
        )}
      </View>

      {showLog && <LogModal onClose={() => setShowLog(false)} />}
    </>
  )
}