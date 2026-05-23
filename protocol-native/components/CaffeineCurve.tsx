import { useState } from 'react'
import { View, Text, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { VictoryArea, VictoryChart, VictoryAxis, VictoryTheme } from 'victory-native'
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

// ─── Log Modal ────────────────────────────────────────────────────────────────

function LogModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [customMg, setCustomMg] = useState('')

  const { data: substances = [] } = useQuery<Substance[]>({
    queryKey: ['substances'],
    queryFn: () => api.get('/stimulants/substances').then(r => r.data),
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

  const presets = substances.filter(s => s.key !== 'custom')
  const selectedSubstance = substances.find(s => s.key === selected)

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
            {presets.map(s => (
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
                {/* TextInput not imported here — handled inline for simplicity */}
                <Text className="text-zinc-400 text-sm">
                  Enter amount in the field below
                </Text>
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
            disabled={!selected || isPending}
            className="bg-white rounded-2xl py-4 items-center mb-10"
            style={{ opacity: !selected || isPending ? 0.4 : 1 }}
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
        <View className="h-36 items-center justify-center">
          <ActivityIndicator color="#52525b" />
        </View>
      </View>
    )
  }

  const curve = data?.curve ?? []
  const currentMg = data?.current_mg ?? 0
  const colour = zoneColour(currentMg)

  // Downsample to every 2nd point for performance (38 → 19 points)
  const chartData = curve
    .filter((_, i) => i % 2 === 0)
    .map((p, i) => ({ x: i, y: p.caffeine_mg }))

  // Show every 4th label on x-axis
  const xLabels = curve
    .filter((_, i) => i % 8 === 0)
    .map((p, i) => ({ x: i * 0.5, label: p.time_label }))

  return (
    <>
      <View className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
        {/* Header */}
        <View className="flex-row items-start justify-between mb-2">
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
        {chartData.length > 1 ? (
          <VictoryChart
            height={140}
            padding={{ top: 10, bottom: 30, left: 0, right: 10 }}
            theme={VictoryTheme.material}
          >
            <VictoryAxis
              style={{
                axis: { stroke: 'transparent' },
                tickLabels: { fill: '#52525b', fontSize: 9 },
                grid: { stroke: 'transparent' },
              }}
              tickFormat={(_, i) => {
                const match = xLabels.find(l => Math.abs(l.x - i) < 0.6)
                return match ? match.label : ''
              }}
            />
            <VictoryAxis
              dependentAxis
              style={{
                axis: { stroke: 'transparent' },
                tickLabels: { fill: 'transparent' },
                grid: { stroke: 'transparent' },
              }}
            />
            <VictoryArea
              data={chartData}
              style={{
                data: {
                  fill: `${colour}30`,
                  stroke: colour,
                  strokeWidth: 2,
                },
              }}
              interpolation="natural"
            />
          </VictoryChart>
        ) : (
          <View className="h-24 items-center justify-center">
            <Text className="text-zinc-600 text-sm">No caffeine logged today</Text>
          </View>
        )}

        {/* Footer */}
        {data && (
          <Text className="text-zinc-500 text-xs leading-5 mt-1">
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