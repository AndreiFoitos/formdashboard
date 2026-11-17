import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { capitalize, formatNumber } from '../lib/format'
import { useMemo, useState } from 'react'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { CountUp } from '../components/CountUp'
import { KEYBOARD_DONE_ID, KeyboardDoneBar } from '../components/KeyboardDoneBar'
import { SwipeableRow } from '../components/SwipeableRow'
import { PressableScale } from '../components/PressableScale'
import { hapticSuccess } from '../lib/haptics'
import { extractErrorMessage } from '../lib/apiError'
import { colors } from '../theme/tokens'
import { draftItem, useMealDraft } from '../store/mealDraft'
import { footerBottomPadding, totalsFooterClearance } from '../theme/layout'

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
  // Describe-a-meal only: the range the description allows and what was
  // assumed ("assumed 1/2 tbsp"). Absent on photo estimates.
  grams_low?: number
  grams_high?: number
  calories_low?: number
  calories_high?: number
  assumption?: string | null
}

/** An estimate item plus the amount the user typed for it, if any. */
type ReviewItem = EstimateItem & { edited?: number }

interface Estimate {
  kind: 'photo' | 'text'
  dish: string
  items: EstimateItem[]
  totals: { calories: number; protein_g: number; fat_g: number; carbs_g: number }
  confidence: number
  disclaimer: string
}

const EMPTY: Estimate = {
  kind: 'photo',
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
const MAX_ITEM_GRAMS = 2000

/** How much of the estimate an item ends up as: the amount the user typed
 *  wins; otherwise the shared portion multiplier applies. */
function factorFor(item: ReviewItem, multiplier: number): number {
  return item.edited != null && item.grams > 0 ? item.edited / item.grams : multiplier
}

// Calibration from the describe-a-meal eval; same constants as
// services/nutrition_text.py (RANGE_*). Keep the two in step.
const RANGE_LOW_STRETCH = 2
const RANGE_MIN_BELOW = 0.2
const RANGE_MIN_ABOVE = 0.1

/** Likely total kcal range, or null when the estimate has no ranges (photos).
 *  Same rule as services/nutrition_text.py total_range: item spreads add in
 *  quadrature (an amount the user typed has no spread left), the low side is
 *  stretched, and the range is never narrower than -20% / +10%. */
function totalRange(items: ReviewItem[], multiplier: number): [number, number] | null {
  if (!items.some((i) => i.calories_low != null && i.calories_high != null)) return null
  let total = 0
  let down = 0
  let up = 0
  for (const i of items) {
    const f = factorFor(i, multiplier)
    const cal = i.calories * f
    total += cal
    if (i.edited != null) continue
    down += ((i.calories - (i.calories_low ?? i.calories)) * f) ** 2
    up += (((i.calories_high ?? i.calories) - i.calories) * f) ** 2
  }
  const round10 = (x: number) => Math.max(0, Math.round(x / 10) * 10)
  const lo = round10(Math.min(total - RANGE_LOW_STRETCH * Math.sqrt(down), total * (1 - RANGE_MIN_BELOW)))
  const hi = round10(Math.max(total + Math.sqrt(up), total * (1 + RANGE_MIN_ABOVE)))
  return hi > lo ? [lo, hi] : null
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function IngredientRow({
  item,
  multiplier,
  isLast,
  open,
  onToggle,
  onSetGrams,
}: {
  item: ReviewItem
  multiplier: number
  isLast: boolean
  open: boolean
  onToggle: () => void
  onSetGrams: (grams: number | undefined) => void
}) {
  const factor = factorFor(item, multiplier)
  const grams = Math.round(item.grams * factor)
  const calories = Math.round(item.calories * factor)
  const fromUSDA = item.source === 'usda'
  const [draft, setDraft] = useState(String(grams))
  const hasRange =
    item.grams_low != null && item.grams_high != null && item.grams_high > item.grams_low

  function change(v: string) {
    const digits = v.replace(/[^0-9]/g, '')
    setDraft(digits)
    const n = parseInt(digits, 10)
    if (n > 0 && n <= MAX_ITEM_GRAMS) onSetGrams(n)
  }

  return (
    <View
      className="bg-surface"
      style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.divider }}
    >
      <TouchableOpacity
        onPress={() => {
          setDraft(String(grams))
          onToggle()
        }}
        activeOpacity={0.7}
        className="px-4 py-3"
      >
        <View className="flex-row items-baseline justify-between">
          <Text className="text-text text-footnote flex-1" numberOfLines={1}>
            {capitalize(item.name)}
          </Text>
          <Text className="text-text-muted text-caption ml-2">{grams} g</Text>
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
          {item.edited != null && <Text className="text-text-subtle text-caption">your amount</Text>}
        </View>
        {item.usda_name && (
          <Text className="text-text-subtle text-caption mt-1" numberOfLines={1}>
            matched: {item.usda_name}
          </Text>
        )}
        {/* The portion describes the unscaled amount, so hide it once the
            amount changes rather than show a label that no longer fits. */}
        {item.portion && factor === 1 && (
          <Text className="text-text-subtle text-caption mt-1" numberOfLines={1}>
            portion: {item.portion}
          </Text>
        )}
        {item.assumption && item.edited == null && (
          <Text className="text-text-subtle text-caption mt-1" numberOfLines={2}>
            {item.assumption} · tap to change
          </Text>
        )}
      </TouchableOpacity>

      {open && (
        <View className="px-4 pb-3 flex-row items-center gap-3">
          <View className="flex-row items-center bg-surface-raised border border-border rounded-md px-3" style={{ borderCurve: 'continuous' }}>
            <TextInput
              value={draft}
              onChangeText={change}
              keyboardType="number-pad"
              inputAccessoryViewID={KEYBOARD_DONE_ID}
              maxLength={4}
              selectTextOnFocus
              autoFocus
              onBlur={() => setDraft(String(Math.round(item.grams * factorFor(item, multiplier))))}
              className="py-3 text-text text-footnote text-right"
              style={{ minWidth: 44 }}
            />
            <Text className="text-text-subtle text-footnote ml-1">g</Text>
          </View>
          <Text className="text-text-subtle text-caption flex-1">
            {hasRange
              ? `Likely ${Math.round(item.grams_low! * factor)}–${Math.round(item.grams_high! * factor)} g from what you said`
              : 'Type the amount you had'}
          </Text>
          {item.edited != null && (
            <TouchableOpacity
              onPress={() => {
                onSetGrams(undefined)
                setDraft(String(Math.round(item.grams * multiplier)))
              }}
              hitSlop={10}
              className="py-2"
            >
              <Text className="text-text-muted text-footnote">Reset</Text>
            </TouchableOpacity>
          )}
        </View>
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
  const { estimate: raw, for: forParam, text } = useLocalSearchParams<{
    estimate: string
    for?: string
    text?: string
  }>()
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
  return (
    <ConfirmContent
      raw={raw}
      forMeal={forParam === 'meal'}
      description={typeof text === 'string' ? text : ''}
    />
  )
}

/** forMeal: opened from the meal builder. Each food becomes its own
 *  ingredient in the meal being built instead of a log entry.
 *  description: the words the estimate came from (describe a meal). */
function ConfirmContent({
  raw,
  forMeal,
  description,
}: {
  raw: string
  forMeal: boolean
  description: string
}) {
  const qc = useQueryClient()

  const initial = useMemo<Estimate>(() => {
    try {
      const p = JSON.parse(raw)
      return {
        kind: p.kind === 'text' ? 'text' : 'photo',
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

  const isText = initial.kind === 'text'
  // Dish name is display-only — the log path writes one row per ingredient,
  // so the composed dish name no longer travels with the data. Kept as
  // context so the user can see what the model recognised.
  const dishName = initial.dish
  const insets = useSafeAreaInsets()
  const [items, setItems] = useState<ReviewItem[]>(initial.items)
  const [multiplier, setMultiplier] = useState<number>(1)
  // Rows are keyed by position; deleting a row closes any open editor.
  const [openRow, setOpenRow] = useState<number | null>(null)

  const totals = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        const f = factorFor(item, multiplier)
        return {
          calories: acc.calories + item.calories * f,
          protein_g: acc.protein_g + item.protein_g * f,
          fat_g: acc.fat_g + item.fat_g * f,
          carbs_g: acc.carbs_g + item.carbs_g * f,
        }
      },
      { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
    )
  }, [items, multiplier])
  const range = useMemo(() => totalRange(items, multiplier), [items, multiplier])

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

  function editDescription() {
    router.replace({
      pathname: '/nutrition-describe',
      params: { text: description, ...(forMeal ? { for: 'meal' } : {}) },
    })
  }

  function setGramsAt(index: number, grams: number | undefined) {
    setItems((prev) => prev.map((it, j) => (j === index ? { ...it, edited: grams } : it)))
  }

  function handleLog() {
    if (items.length === 0) {
      Alert.alert('Nothing to log', isText ? 'Add at least one food or edit the description.' : 'Add at least one ingredient or go back to retake.')
      return
    }
    if (forMeal) {
      useMealDraft.getState().add(
        items.map((item) => {
          const f = factorFor(item, multiplier)
          return draftItem(item.name, item.grams * f, {
            calories: item.calories * f,
            protein_g: item.protein_g * f,
            carbs_g: item.carbs_g * f,
            fat_g: item.fat_g * f,
          })
        }),
      )
      hapticSuccess()
      router.back()
      return
    }
    // Decompose to one NutritionLog row per ingredient — each row's meal_name
    // is the ingredient ("chicken breast"), not the dish ("Chicken rice bowl").
    // This makes every ingredient eligible for /nutrition/frequent on its own.
    // source='photo_item' / 'text_item' distinguishes these from legacy
    // dish-level photo rows so the Frequent endpoint can keep filtering the
    // old composed entries out.
    const entries = items.map((item) => {
      const f = factorFor(item, multiplier)
      return {
        meal_name: item.name,
        calories: Math.round(item.calories * f),
        protein_g: Math.round(item.protein_g * f * 10) / 10,
        carbs_g: Math.round(item.carbs_g * f * 10) / 10,
        fat_g: Math.round(item.fat_g * f * 10) / 10,
        source: isText ? 'text_item' : 'photo_item',
      }
    })
    mutate({ entries })
  }

  const usdaCount = items.filter((i) => i.source === 'usda').length
  const hasItems = items.length > 0

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      {/* Describe uses replace, so back returns to the Nutrition tab. */}
      {isText && <Stack.Screen options={{ headerBackTitle: 'Back' }} />}
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: totalsFooterClearance(insets.bottom) }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
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
            {isText && description ? (
              <View className="flex-row items-start gap-3 mt-2">
                <Text className="text-text-muted text-footnote flex-1" numberOfLines={3}>
                  “{description}”
                </Text>
                <TouchableOpacity onPress={editDescription} hitSlop={10} className="py-1">
                  <Text className="text-text text-footnote font-semibold">Edit</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <Text className="text-text-subtle text-caption mt-2">
              Each food below is logged as its own entry. Tap one to change its amount, swipe
              to remove.
            </Text>
          </View>

          {/* Confidence chip + USDA chip. A text estimate shows its likely
              range instead of a confidence figure (docs/describe-meal-research.md D2). */}
          <View className="flex-row items-center mt-3 gap-2 flex-wrap">
            {!isText && (
              <View className="bg-surface border border-divider rounded-full px-3 py-1" style={{ borderCurve: 'continuous' }}>
                <Text className="text-text-muted text-caption">
                  {Math.round(initial.confidence * 100)}% confident
                </Text>
              </View>
            )}
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
              {multiplier === 1 ? 'as estimated' : `${multiplier}× estimated`}
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
          {items.some((i) => i.edited != null) && (
            <Text className="text-text-subtle text-caption mt-2">
              Amounts you typed stay as they are.
            </Text>
          )}
        </View>

        {/* Ingredients */}
        <View className="px-4 pt-5">
          <View className="flex-row items-baseline justify-between mb-2">
            <Text className="text-text-subtle text-caption">
              {isText ? 'Foods' : 'Ingredients'} ({items.length})
            </Text>
            <Text className="text-text-subtle text-caption">swipe to remove</Text>
          </View>
          {items.length === 0 ? (
            <View className="bg-surface border border-divider rounded-xl p-6 items-center" style={{ borderCurve: 'continuous' }}>
              <Text className="text-text-muted text-footnote">No foods identified</Text>
              <Text className="text-text-subtle text-caption mt-1">
                {isText ? 'Edit the description and try again' : 'Go back and retake the photo'}
              </Text>
            </View>
          ) : (
            <View className="bg-surface border border-divider rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
              {items.map((item, i) => (
                <SwipeableRow
                  key={`${item.name}-${i}`}
                  onDelete={() => {
                    setOpenRow(null)
                    setItems(items.filter((_, j) => j !== i))
                  }}
                >
                  <IngredientRow
                    item={item}
                    multiplier={multiplier}
                    isLast={i === items.length - 1}
                    open={openRow === i}
                    onToggle={() => setOpenRow(openRow === i ? null : i)}
                    onSetGrams={(g) => setGramsAt(i, g)}
                  />
                </SwipeableRow>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Bottom totals + log button */}
      <View className="absolute bottom-0 left-0 right-0 bg-bg border-t border-divider px-4 pt-3" style={{ paddingBottom: footerBottomPadding(insets.bottom) }}>
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
            {range && (
              <Text className="text-text-subtle text-caption mt-1">
                likely {formatNumber(range[0])}–{formatNumber(range[1])}
              </Text>
            )}
          </View>
          <View className="flex-row gap-3">
            <MacroChip label="P" value={totals.protein_g} color={colors.data.protein} />
            <MacroChip label="C" value={totals.carbs_g} color={colors.data.carbs} />
            <MacroChip label="F" value={totals.fat_g} color={colors.data.fat} />
          </View>
        </View>
        <PressableScale
          haptic
          onPress={hasItems ? handleLog : isText ? editDescription : () => router.back()}
          disabled={isPending}
          className="bg-accent rounded-md py-4 items-center"
          style={{ borderCurve: 'continuous', opacity: isPending ? 0.5 : 1 }}
        >
          {isPending ? (
            <ActivityIndicator color={colors['on-accent']} />
          ) : (
            <Text className="text-on-accent font-semibold text-body">
              {hasItems
                ? (forMeal ? `Add ${items.length} to meal` : 'Log meal')
                : isText ? 'Edit description' : 'Retake photo'}
            </Text>
          )}
        </PressableScale>
      </View>
      <KeyboardDoneBar />
    </SafeAreaView>
  )
}
