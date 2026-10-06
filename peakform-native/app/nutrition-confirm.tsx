import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useMemo, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react-native'
import { api } from '../api/client'
import { CountUp } from '../components/CountUp'
import { SwipeableRow } from '../components/SwipeableRow'
import { PressableScale } from '../components/PressableScale'
import { hapticSuccess } from '../lib/haptics'
import { extractErrorMessage } from '../lib/apiError'
import { colors } from '../theme/tokens'
import { TOTALS_FOOTER_CLEARANCE } from '../theme/layout'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EstimateItem {
  name: string
  grams: number
  calories: number
  protein_g: number
  fat_g: number
  carbs_g: number
  source: 'usda' | 'claude_fallback'
  usda_name: string | null
  // USDA household portion the amount was picked from, e.g. "1.5 × 1 cup,
  // cooked". Absent on older backends and when the amount was a gram guess.
  portion?: string | null
}

interface Estimate {
  dish: string
  items: EstimateItem[]
  totals: { calories: number; protein_g: number; fat_g: number; carbs_g: number }
  confidence: number
  disclaimer: string
}

const EMPTY: Estimate = {
  dish: '',
  items: [],
  totals: { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
  confidence: 0,
  disclaimer: '',
}

// Discrete portion multipliers — simpler and less error-prone than a continuous
// slider, and people think in "about half" / "double" rather than 0.83×.
const PORTION_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
const PORTION_LABELS = ['½×', '¾×', '1×', '1¼×', '1½×', '2×']

// ─── Sub-components ───────────────────────────────────────────────────────────

function IngredientRow({
  item,
  multiplier,
  isLast,
}: {
  item: EstimateItem
  multiplier: number
  isLast: boolean
}) {
  const grams = Math.round(item.grams * multiplier)
  const calories = Math.round(item.calories * multiplier)
  const fromUSDA = item.source === 'usda'

  return (
    <View
      className="px-4 py-3 bg-surface"
      style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.divider }}
    >
      <View className="flex-row items-baseline justify-between">
        <Text className="text-text text-footnote flex-1" numberOfLines={1}>
          {item.name}
        </Text>
        <Text className="text-text-muted text-caption ml-2">{grams}g</Text>
      </View>
      <View className="flex-row items-center gap-2 mt-1">
        <Text className="text-text-subtle text-caption">{calories} kcal</Text>
        <View
          className="rounded-full px-2 py-1"
          style={{
            borderCurve: 'continuous',
            backgroundColor: fromUSDA ? `${colors.success}26` : colors['surface-raised'],
            borderWidth: 1,
            borderColor: fromUSDA ? `${colors.success}66` : colors.border,
          }}
        >
          <Text className="text-caption" style={{ color: fromUSDA ? colors.success : colors['text-muted'] }}>
            {fromUSDA ? 'USDA' : 'AI'}
          </Text>
        </View>
      </View>
      {item.usda_name && (
        <Text className="text-text-subtle text-caption mt-1" numberOfLines={1}>
          matched: {item.usda_name}
        </Text>
      )}
      {/* The portion describes the unscaled amount, so hide it once the user
          changes the multiplier rather than show a label that no longer fits. */}
      {item.portion && multiplier === 1 && (
        <Text className="text-text-subtle text-caption mt-1" numberOfLines={1}>
          portion: {item.portion}
        </Text>
      )}
    </View>
  )
}

function MacroChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View className="flex-row items-baseline gap-1">
      <Text className="text-text-subtle text-caption">{label}</Text>
      <Text className="text-footnote font-semibold" style={{ color }}>
        {Math.round(value)}g
      </Text>
    </View>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NutritionConfirmScreen() {
  const { estimate: raw } = useLocalSearchParams<{ estimate: string }>()
  // Guard against the brief moment where expo-router hasn't hydrated params
  // yet. Without it, useState below would lock items=[] for the lifetime of
  // the screen when raw is undefined on the very first render.
  if (typeof raw !== 'string') {
    return (
      <SafeAreaView
        className="flex-1 bg-bg items-center justify-center"
        edges={['top']}
      >
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    )
  }
  return <ConfirmContent raw={raw} />
}

function ConfirmContent({ raw }: { raw: string }) {
  const qc = useQueryClient()

  const initial = useMemo<Estimate>(() => {
    try {
      const p = JSON.parse(raw)
      return {
        dish: typeof p.dish === 'string' ? p.dish : '',
        items: Array.isArray(p.items) ? p.items : [],
        totals: p.totals ?? { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
        confidence: typeof p.confidence === 'number' ? p.confidence : 0,
        disclaimer: typeof p.disclaimer === 'string' ? p.disclaimer : '',
      }
    } catch {
      return EMPTY
    }
  }, [raw])

  // Dish name is now display-only — the log path writes one row per
  // ingredient, so the composed dish name no longer travels with the data.
  // Kept as context so the user can see what the model recognised.
  const dishName = initial.dish
  const [items, setItems] = useState<EstimateItem[]>(initial.items)
  const [multiplier, setMultiplier] = useState<number>(1)

  const totals = useMemo(() => {
    return items.reduce(
      (acc, item) => ({
        calories: acc.calories + item.calories * multiplier,
        protein_g: acc.protein_g + item.protein_g * multiplier,
        fat_g: acc.fat_g + item.fat_g * multiplier,
        carbs_g: acc.carbs_g + item.carbs_g * multiplier,
      }),
      { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
    )
  }, [items, multiplier])

  const { mutate, isPending } = useMutation({
    mutationFn: (body: object) => api.post('/nutrition/log-batch', body),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['nutrition-today'] })
      router.back()
    },
    onError: (err: any) => {
      Alert.alert("Couldn't log meal", extractErrorMessage(err, 'Please try again.'))
    },
  })

  function handleLog() {
    if (items.length === 0) {
      Alert.alert('Nothing to log', 'Add at least one ingredient or go back to retake.')
      return
    }
    // Decompose to one NutritionLog row per ingredient — each row's meal_name
    // is the ingredient ("chicken breast"), not the dish ("Chicken rice bowl").
    // This makes every ingredient eligible for /nutrition/frequent on its own.
    // source='photo_item' distinguishes from legacy dish-level photo rows so
    // the Frequent endpoint can keep filtering the old composed entries out.
    const entries = items.map((item) => ({
      meal_name: item.name,
      calories: Math.round(item.calories * multiplier),
      protein_g: Math.round(item.protein_g * multiplier * 10) / 10,
      carbs_g: Math.round(item.carbs_g * multiplier * 10) / 10,
      fat_g: Math.round(item.fat_g * multiplier * 10) / 10,
      source: 'photo_item',
    }))
    mutate({ entries })
  }

  const usdaCount = items.filter((i) => i.source === 'usda').length
  const hasItems = items.length > 0

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-divider">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="-ml-1 px-2 py-2 flex-row items-center gap-1">
          <ChevronLeft size={22} color={colors.text} strokeWidth={2.25} />
          <Text className="text-text-muted text-body font-medium">Retake</Text>
        </TouchableOpacity>
        <Text className="text-text font-semibold">Review meal</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: TOTALS_FOOTER_CLEARANCE }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Recognised-as label. Read-only; each ingredient is logged
            separately so there's no composed-meal name to edit. */}
        <View className="px-4 pt-4">
          <Text className="text-text-subtle text-caption mb-2">
            Recognised as
          </Text>
          <View className="bg-surface border border-divider rounded-xl px-4 py-3" style={{ borderCurve: 'continuous' }}>
            <Text className="text-text text-body" numberOfLines={2}>
              {dishName || 'Unknown dish'}
            </Text>
            <Text className="text-text-subtle text-caption mt-2">
              Each ingredient below is logged as its own entry — edit portions or
              swipe to remove.
            </Text>
          </View>

          {/* Confidence chip + USDA chip */}
          <View className="flex-row items-center mt-3 gap-2 flex-wrap">
            <View className="bg-surface border border-divider rounded-full px-3 py-1" style={{ borderCurve: 'continuous' }}>
              <Text className="text-text-muted text-caption">
                {Math.round(initial.confidence * 100)}% confident
              </Text>
            </View>
            {items.length > 0 && (
              <View className="bg-surface border border-divider rounded-full px-3 py-1" style={{ borderCurve: 'continuous' }}>
                <Text className="text-text-muted text-caption">
                  {usdaCount}/{items.length} from USDA
                </Text>
              </View>
            )}
          </View>
          {initial.disclaimer ? (
            <Text className="text-text-subtle text-caption mt-2">{initial.disclaimer}</Text>
          ) : null}
        </View>

        {/* Portion multiplier */}
        <View className="px-4 pt-5">
          <View className="flex-row items-baseline justify-between mb-2">
            <Text className="text-text-subtle text-caption">
              Portion size
            </Text>
            <Text className="text-text-subtle text-caption">
              {multiplier === 1 ? 'as detected' : `${multiplier}× detected`}
            </Text>
          </View>
          <View className="flex-row gap-2">
            {PORTION_STEPS.map((step, i) => {
              const active = multiplier === step
              return (
                <TouchableOpacity
                  key={step}
                  onPress={() => setMultiplier(step)}
                  className="flex-1 rounded-full py-3 border"
                  style={{
                    borderCurve: 'continuous',
                    backgroundColor: active ? colors.text : colors.surface,
                    borderColor: active ? colors.text : colors.border,
                  }}
                >
                  <Text
                    className="text-caption text-center font-medium"
                    style={{ color: active ? colors.bg : colors['text-muted'] }}
                  >
                    {PORTION_LABELS[i]}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        {/* Ingredients */}
        <View className="px-4 pt-5">
          <View className="flex-row items-baseline justify-between mb-2">
            <Text className="text-text-subtle text-caption">
              Ingredients ({items.length})
            </Text>
            <Text className="text-text-subtle text-caption">swipe to remove</Text>
          </View>
          {items.length === 0 ? (
            <View className="bg-surface border border-divider rounded-xl p-6 items-center" style={{ borderCurve: 'continuous' }}>
              <Text className="text-text-muted text-footnote">No ingredients identified</Text>
              <Text className="text-text-subtle text-caption mt-1">Go back and retake the photo</Text>
            </View>
          ) : (
            <View className="bg-surface border border-divider rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
              {items.map((item, i) => (
                <SwipeableRow
                  key={`${item.name}-${i}`}
                  onDelete={() => setItems(items.filter((_, j) => j !== i))}
                >
                  <IngredientRow
                    item={item}
                    multiplier={multiplier}
                    isLast={i === items.length - 1}
                  />
                </SwipeableRow>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Bottom totals + log button */}
      <View className="absolute bottom-0 left-0 right-0 bg-bg border-t border-divider px-4 pt-3 pb-8">
        <View className="flex-row items-center justify-between mb-3">
          <View>
            <Text className="text-text-subtle text-caption mb-1">
              Total
            </Text>
            <View className="flex-row items-baseline gap-2">
              <CountUp
                value={Math.round(totals.calories)}
                separator
                className="text-text text-title font-bold"
              />
              <Text className="text-text-subtle text-footnote">kcal</Text>
            </View>
          </View>
          <View className="flex-row gap-3">
            <MacroChip label="P" value={totals.protein_g} color={colors.data.protein} />
            <MacroChip label="C" value={totals.carbs_g} color={colors.data.carbs} />
            <MacroChip label="F" value={totals.fat_g} color={colors.data.fat} />
          </View>
        </View>
        <PressableScale
          haptic
          onPress={hasItems ? handleLog : () => router.back()}
          disabled={isPending}
          className="bg-accent rounded-md py-4 items-center"
          style={{ borderCurve: 'continuous', opacity: isPending ? 0.5 : 1 }}
        >
          {isPending ? (
            <ActivityIndicator color={colors['on-accent']} />
          ) : (
            <Text className="text-on-accent font-semibold text-body">
              {hasItems ? 'Log meal' : 'Retake photo'}
            </Text>
          )}
        </PressableScale>
      </View>
    </SafeAreaView>
  )
}
