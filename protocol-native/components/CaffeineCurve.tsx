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
import Svg, { Polyline, Line, Defs, LinearGradient, Stop, Polygon } from 'react-native-svg'
import { api } from '../api/client'

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
}

interface Substance {
  key: string
  label: string
  caffeine_mg: number
  half_life: number
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
  const chartHeight = 100
  const paddingLeft = 4
  const paddingRight = 4
  const paddingTop = 6
  const paddingBottom = 18

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

  // X-axis labels: every 8 points (~4 labels)
  const labelStep = Math.max(1, Math.floor(curve.length / 4))
  const xLabels = curve
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i % labelStep === 0)

  // Reference lines (50, 200, 300 mg)
  const refLines = [50, 200, 300].filter((v) => v < maxV * 1.1)

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
    </Svg>
  )
}

// ─── Log Modal ────────────────────────────────────────────────────────────────

function LogModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [customMg, setCustomMg] = useState('')

  const { data: substances = [] } = useQuery<Substance[]>({
    queryKey: ['substances'],
    queryFn: () => api.get('/stimulants/substances').then((r) => r.data),
    staleTime: Infinity,
  })

  const { mutate, isPending } = useMutation({
    mutationFn: (body: { substance: string; caffeine_mg?: number }) =>
      api.post('/stimulants/log', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    },
  })

  function handleLog() {
    if (!selected) return
    const body: { substance: string; caffeine_mg?: number } = { substance: selected }
    if (selected === 'custom' && customMg) {
      body.caffeine_mg = parseInt(customMg)
    }
    mutate(body)
  }

  const presets = substances.filter((s) => s.key !== 'custom')
  const selectedSubstance = substances.find((s) => s.key === selected)

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
                onPress={() => setSelected(s.key)}
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
                  {s.caffeine_mg}mg caffeine
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              onPress={() => setSelected('custom')}
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

          {selectedSubstance && selected !== 'custom' && (
            <Text className="text-zinc-500 text-xs mb-4">
              {selectedSubstance.caffeine_mg}mg · half-life {selectedSubstance.half_life}h
            </Text>
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

  return (
    <>
      <View className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
        {/* Header */}
        <View className="flex-row items-start justify-between mb-3">
          <View>
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
          <TouchableOpacity
            onPress={() => setShowLog(true)}
            className="bg-zinc-800 px-3 py-1.5 rounded-xl"
          >
            <Text className="text-zinc-400 text-xs font-medium">+ Log</Text>
          </TouchableOpacity>
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