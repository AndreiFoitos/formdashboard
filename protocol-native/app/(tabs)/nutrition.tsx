import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Modal,
} from 'react-native'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../../api/client'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { CountUp } from '../../components/CountUp'
import { AnimatedBar } from '../../components/AnimatedBar'
import { SkeletonCard } from '../../components/Skeleton'
import { SwipeableRow } from '../../components/SwipeableRow'
import { PressableScale } from '../../components/PressableScale'
import { hapticSuccess } from '../../lib/haptics'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NutritionEntry {
  id: string
  meal_name: string | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  logged_at: string
}

interface NutritionToday {
  totals: {
    calories: number
    protein_g: number
    carbs_g: number
    fat_g: number
  }
  targets: {
    calories: number | null
    protein_g: number | null
  }
  entries: NutritionEntry[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MEAL_PRESETS = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Pre-workout', 'Post-workout']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function pct(value: number, target: number | null) {
  if (!target) return null
  return Math.min(100, Math.round((value / target) * 100))
}

// ─── Calorie Bar ──────────────────────────────────────────────────────────────

function CalorieBar({ calories, target }: { calories: number; target: number | null }) {
  const p = pct(calories, target) ?? 0
  const over = target != null && calories > target

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <View className="flex-row items-end justify-between mb-3">
        <View>
          <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1">
            Calories
          </Text>
          <View className="flex-row items-baseline gap-1.5">
            <CountUp
              value={calories}
              separator
              className="text-white text-3xl font-bold"
            />
            {target && (
              <Text className="text-zinc-500 text-sm">/ {target.toLocaleString()} kcal</Text>
            )}
          </View>
        </View>
        {over && (
          <View className="bg-orange-950 border border-orange-900 px-2 py-1 rounded-full">
            <Text className="text-orange-400 text-xs font-medium">
              +{(calories - target!).toLocaleString()} over
            </Text>
          </View>
        )}
      </View>

      <AnimatedBar percent={Math.min(100, p)} color={over ? '#f97316' : '#ffffff'} height={6} />
      {target && (
        <Text className="text-zinc-600 text-xs mt-1.5">{p}% of daily target</Text>
      )}
    </View>
  )
}

// ─── Macro Card ───────────────────────────────────────────────────────────────

function MacroCard({
  label,
  value,
  target,
  unit,
  color,
}: {
  label: string
  value: number
  target: number | null
  unit: string
  color: string
}) {
  const p = pct(value, target)

  return (
    <View className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
        {label}
      </Text>
      <Text className="text-white font-bold text-lg">
        {Math.round(value)}
        <Text className="text-zinc-500 text-xs font-normal"> {unit}</Text>
      </Text>
      {target && (
        <>
          <AnimatedBar
            percent={Math.min(100, p ?? 0)}
            color={color}
            height={4}
            style={{ marginTop: 8 }}
          />
          <Text className="text-zinc-600 text-xs mt-1">
            of {Math.round(target)}{unit}
          </Text>
        </>
      )}
    </View>
  )
}

// ─── Macro Split Bar ──────────────────────────────────────────────────────────

function MacroSplitBar({
  protein,
  carbs,
  fat,
}: {
  protein: number
  carbs: number
  fat: number
}) {
  const total = protein * 4 + carbs * 4 + fat * 9
  if (total === 0) return null

  const proteinPct = Math.round((protein * 4 / total) * 100)
  const carbsPct = Math.round((carbs * 4 / total) * 100)
  const fatPct = 100 - proteinPct - carbsPct

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-3">
        Macro Split
      </Text>
      <View className="flex-row h-2 rounded-full overflow-hidden gap-px mb-3">
        <View style={{ flex: proteinPct, backgroundColor: '#818cf8', borderRadius: 4 }} />
        <View style={{ flex: carbsPct, backgroundColor: '#34d399' }} />
        <View style={{ flex: Math.max(0, fatPct), backgroundColor: '#fbbf24', borderRadius: 4 }} />
      </View>
      <View className="flex-row gap-4">
        {[
          { label: 'Protein', p: proteinPct, color: '#818cf8' },
          { label: 'Carbs', p: carbsPct, color: '#34d399' },
          { label: 'Fat', p: Math.max(0, fatPct), color: '#fbbf24' },
        ].map(({ label, p, color }) => (
          <View key={label} className="flex-row items-center gap-1.5">
            <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
            <Text className="text-zinc-400 text-xs">{label}</Text>
            <Text className="text-white text-xs font-medium">{p}%</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// ─── Log Modal ────────────────────────────────────────────────────────────────

function LogModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [mealName, setMealName] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: (body: object) => api.post('/nutrition/log', body),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['nutrition-today'] })
      onClose()
    },
  })

  const hasAnyValue = calories || protein || carbs || fat

  const estimatedCals =
    !calories && (protein || carbs || fat)
      ? Math.round(
          parseFloat(protein || '0') * 4 +
          parseFloat(carbs || '0') * 4 +
          parseFloat(fat || '0') * 9,
        )
      : null

  function handleLog() {
    mutate({
      meal_name: mealName.trim() || null,
      calories: calories ? parseInt(calories) : null,
      protein_g: protein ? parseFloat(protein) : null,
      carbs_g: carbs ? parseFloat(carbs) : null,
      fat_g: fat ? parseFloat(fat) : null,
    })
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
          <Text className="text-white font-semibold">Log Meal</Text>
          <TouchableOpacity onPress={onClose}>
            <Text className="text-zinc-400 text-sm">✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled">
          {/* Meal name presets */}
          <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
            Meal
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mb-3"
            contentContainerStyle={{ gap: 8 }}
          >
            {MEAL_PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset}
                onPress={() => setMealName(mealName === preset ? '' : preset)}
                className="px-3 py-1.5 rounded-full border"
                style={{
                  backgroundColor: mealName === preset ? 'white' : '#18181b',
                  borderColor: mealName === preset ? 'white' : '#3f3f46',
                }}
              >
                <Text
                  className="text-xs"
                  style={{ color: mealName === preset ? 'black' : '#a1a1aa' }}
                >
                  {preset}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TextInput
            value={mealName}
            onChangeText={setMealName}
            placeholder="Or type a name…"
            placeholderTextColor="#52525b"
            className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-white text-sm mb-5"
          />

          {/* Calories */}
          <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1.5">
            Calories
          </Text>
          <View className="mb-4">
            <TextInput
              value={calories}
              onChangeText={setCalories}
              placeholder={estimatedCals ? `~${estimatedCals} (estimated)` : 'e.g. 450'}
              placeholderTextColor="#52525b"
              keyboardType="number-pad"
              className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm"
            />
          </View>

          {/* Macros */}
          <View className="flex-row gap-2 mb-2">
            {[
              { label: 'Protein', value: protein, set: setProtein, color: '#818cf8' },
              { label: 'Carbs', value: carbs, set: setCarbs, color: '#34d399' },
              { label: 'Fat', value: fat, set: setFat, color: '#fbbf24' },
            ].map(({ label, value, set, color }) => (
              <View key={label} className="flex-1">
                <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1.5">
                  {label}
                </Text>
                <TextInput
                  value={value}
                  onChangeText={set}
                  placeholder="0"
                  placeholderTextColor="#52525b"
                  keyboardType="decimal-pad"
                  className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-white text-sm"
                  style={{ borderColor: value ? `${color}60` : '#3f3f46' }}
                />
                <Text className="text-zinc-600 text-xs mt-0.5 text-right">g</Text>
              </View>
            ))}
          </View>

          {estimatedCals != null && estimatedCals > 0 && (
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-zinc-500 text-xs">
                ~{estimatedCals} kcal estimated from macros
              </Text>
              <TouchableOpacity onPress={() => setCalories(String(estimatedCals))}>
                <Text className="text-zinc-400 text-xs underline">use this</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            onPress={handleLog}
            disabled={!hasAnyValue || isPending}
            className="bg-white rounded-2xl py-4 items-center mb-10"
            style={{ opacity: !hasAnyValue || isPending ? 0.4 : 1 }}
          >
            {isPending ? (
              <ActivityIndicator color="black" />
            ) : (
              <Text className="text-black font-semibold text-base">Log Meal</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  )
}

// ─── Entry Row ────────────────────────────────────────────────────────────────

function EntryRow({
  entry,
  isLast,
}: {
  entry: NutritionEntry
  isLast: boolean
}) {
  return (
    <View
      className="flex-row items-start gap-3 px-4 py-4 bg-zinc-900"
      style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#27272a' }}
    >
      <View className="mt-2">
        <View className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
      </View>

      <View className="flex-1">
        <View className="flex-row items-baseline justify-between">
          <Text className="text-white text-sm font-medium flex-1" numberOfLines={1}>
            {entry.meal_name ?? 'Unnamed meal'}
          </Text>
          <Text className="text-zinc-500 text-xs ml-2">{formatTime(entry.logged_at)}</Text>
        </View>
        <View className="flex-row flex-wrap gap-x-3 mt-1">
          {entry.calories != null && (
            <Text className="text-zinc-400 text-xs">
              {entry.calories.toLocaleString()} kcal
            </Text>
          )}
          {entry.protein_g != null && (
            <Text className="text-xs" style={{ color: '#818cf8' }}>
              {Math.round(entry.protein_g)}g protein
            </Text>
          )}
          {entry.carbs_g != null && (
            <Text className="text-xs" style={{ color: '#34d399' }}>
              {Math.round(entry.carbs_g)}g carbs
            </Text>
          )}
          {entry.fat_g != null && (
            <Text className="text-xs" style={{ color: '#fbbf24' }}>
              {Math.round(entry.fat_g)}g fat
            </Text>
          )}
        </View>
      </View>
    </View>
  )
}

// ─── Nutrition Screen ─────────────────────────────────────────────────────────

export default function NutritionScreen() {
  const { user } = useRequireAuth()
  const [showLog, setShowLog] = useState(false)
  const qc = useQueryClient()

  const { data, isLoading, refetch, isRefetching } = useQuery<NutritionToday>({
    queryKey: ['nutrition-today'],
    queryFn: () => api.get('/nutrition/today').then((r) => r.data),
    refetchInterval: 5 * 60 * 1000,
    enabled: !!user,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/nutrition/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nutrition-today'] }),
  })

  const totals = data?.totals ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  const targets = data?.targets ?? { calories: null, protein_g: null }
  const entries = data?.entries ?? []

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
            <Text className="text-white text-2xl font-bold mt-1">Nutrition</Text>
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
            <SkeletonCard height={92} />
            <View className="flex-row gap-3">
              <View className="flex-1"><SkeletonCard height={72} /></View>
              <View className="flex-1"><SkeletonCard height={72} /></View>
              <View className="flex-1"><SkeletonCard height={72} /></View>
            </View>
            <SkeletonCard height={64} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <CalorieBar calories={totals.calories} target={targets.calories} />

            <View className="flex-row gap-3">
              <MacroCard
                label="Protein"
                value={totals.protein_g}
                target={targets.protein_g}
                unit="g"
                color="#818cf8"
              />
              <MacroCard
                label="Carbs"
                value={totals.carbs_g}
                target={null}
                unit="g"
                color="#34d399"
              />
              <MacroCard
                label="Fat"
                value={totals.fat_g}
                target={null}
                unit="g"
                color="#fbbf24"
              />
            </View>

            {(totals.protein_g > 0 || totals.carbs_g > 0 || totals.fat_g > 0) && (
              <MacroSplitBar
                protein={totals.protein_g}
                carbs={totals.carbs_g}
                fat={totals.fat_g}
              />
            )}

            <Text className="text-zinc-500 text-xs uppercase tracking-widest">
              Today's Meals
            </Text>

            {entries.length === 0 ? (
              <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 items-center">
                <Text className="text-zinc-400 text-sm font-medium">Nothing logged yet</Text>
                <Text className="text-zinc-600 text-xs mt-1 mb-4">
                  Track your meals to hit your targets
                </Text>
                <TouchableOpacity
                  onPress={() => setShowLog(true)}
                  className="bg-zinc-800 px-4 py-2 rounded-2xl"
                >
                  <Text className="text-white text-sm font-medium">
                    Log your first meal →
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                {entries.map((entry, i) => (
                  <SwipeableRow
                    key={entry.id}
                    onDelete={() => deleteMutation.mutate(entry.id)}
                  >
                    <EntryRow entry={entry} isLast={i === entries.length - 1} />
                  </SwipeableRow>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {showLog && <LogModal onClose={() => setShowLog(false)} />}
    </SafeAreaView>
  )
}