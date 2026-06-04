import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Bookmark, Camera, MoreHorizontal, Search as SearchIcon, X } from 'lucide-react-native'
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

// ─── Search types ─────────────────────────────────────────────────────────────

interface PerHundredGrams {
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

interface SearchResult {
  fdc_id: number | null
  name: string
  // Present on /frequent results: the user-typed meal_name from their history.
  // Prefer this over the USDA description when displaying.
  logged_name?: string
  per_100g: PerHundredGrams
}

interface SearchResponse {
  results: SearchResult[]
}

interface SavedMealItem {
  id: string
  food_name: string
  grams: number | null
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

interface SavedMeal {
  id: string
  name: string
  // Empty string for manual meals, one of the four buckets for auto-detected.
  time_bucket: 'morning' | 'midday' | 'evening' | 'late' | ''
  source: 'manual' | 'auto'
  auto_generated_name: boolean
  created_at: string
  items: SavedMealItem[]
  total_calories: number
  total_protein_g: number
  total_carbs_g: number
  total_fat_g: number
}

interface SavedMealsResponse {
  meals: SavedMeal[]
}

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
      <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-2 font-semibold">
        {label}
      </Text>
      <Text className="text-white font-bold text-2xl">
        {Math.round(value)}
        <Text className="text-zinc-500 text-sm font-normal"> {unit}</Text>
      </Text>
      {target && (
        <>
          <AnimatedBar
            percent={Math.min(100, p ?? 0)}
            color={color}
            height={5}
            style={{ marginTop: 10 }}
          />
          <Text className="text-zinc-500 text-xs mt-1.5 font-medium">
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
//
// Search-first: results list at top with one-tap per-row logging, manual macro
// entry always visible at the bottom as a fallback. The [Photo] toggle hands
// off to the existing /nutrition-snap screen (closes this modal first so the
// camera screen owns the stack).

function SearchResultRow({
  result,
  onLog,
  busy,
}: {
  result: SearchResult
  onLog: (grams: number) => void
  busy?: boolean
}) {
  // Default to 100 g — the USDA reference portion. For most foods this is
  // close to a real serving and lets the user one-tap log without editing
  // the field. Bananas / eggs etc. read odd at 100g, but the kcal-at-100g
  // line under the name makes the trade-off visible.
  const [grams, setGrams] = useState('100')
  const gramsNum = parseInt(grams, 10) || 0
  const canLog = gramsNum > 0 && !busy
  const displayName = result.logged_name ?? result.name

  function handlePress() {
    if (!canLog) return
    onLog(gramsNum)
    // Reset to default so the next log of the same row is one-tap again.
    setGrams('100')
  }

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl px-3 py-3 flex-row items-center">
      <View className="flex-1 pr-3">
        <Text className="text-white text-sm font-medium" numberOfLines={1}>
          {displayName}
        </Text>
        <Text className="text-zinc-500 text-xs mt-0.5">
          ~{result.per_100g.calories} kcal/100g
        </Text>
      </View>
      <TextInput
        value={grams}
        onChangeText={setGrams}
        placeholder="g"
        placeholderTextColor="#52525b"
        keyboardType="number-pad"
        selectTextOnFocus
        className="bg-zinc-950 border border-zinc-800 rounded-xl px-2 py-1.5 text-white text-sm text-right mr-1.5"
        style={{ width: 56 }}
      />
      <TouchableOpacity
        onPress={handlePress}
        disabled={!canLog}
        className="bg-white rounded-xl px-3 py-1.5"
        style={{ opacity: canLog ? 1 : 0.4 }}
      >
        <Text className="text-black text-sm font-semibold">+</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Build meal modal ────────────────────────────────────────────────────────

interface DraftItem {
  food_name: string
  grams: number
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

function BuildMealModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [draft, setDraft] = useState<DraftItem[]>([])

  // Debounce so we don't hit USDA on every keystroke. Same 300ms as Search tab.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const searchQuery = useQuery<SearchResponse>({
    queryKey: ['nutrition-search', debouncedQuery],
    queryFn: () =>
      api.get(`/nutrition/search?q=${encodeURIComponent(debouncedQuery)}`).then((r) => r.data),
    enabled: debouncedQuery.length > 0,
    staleTime: 60 * 1000,
  })

  function addIngredient(result: SearchResult, grams: number) {
    if (grams <= 0) return
    const factor = grams / 100
    setDraft((prev) => [
      ...prev,
      {
        food_name: result.logged_name ?? result.name,
        grams,
        calories: Math.round(result.per_100g.calories * factor),
        protein_g: Math.round(result.per_100g.protein_g * factor * 10) / 10,
        carbs_g: Math.round(result.per_100g.carbs_g * factor * 10) / 10,
        fat_g: Math.round(result.per_100g.fat_g * factor * 10) / 10,
      },
    ])
    setQuery('')
  }

  function removeIngredient(idx: number) {
    setDraft((prev) => prev.filter((_, i) => i !== idx))
  }

  // Aggregate totals shown at the bottom and used to compose the save payload.
  const totals = draft.reduce(
    (acc, d) => ({
      calories: acc.calories + d.calories,
      protein_g: acc.protein_g + d.protein_g,
      carbs_g: acc.carbs_g + d.carbs_g,
      fat_g: acc.fat_g + d.fat_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  )

  const saveMutation = useMutation({
    mutationFn: (body: object) => api.post('/nutrition/saved-meals', body),
    onSuccess: () => {
      hapticSuccess()
      onSaved()
    },
    onError: (err: any) => {
      Alert.alert("Couldn't save meal", err?.response?.data?.detail ?? 'Try again')
    },
  })

  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && draft.length > 0 && !saveMutation.isPending

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-zinc-950">
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 bg-zinc-700 rounded-full" />
        </View>

        <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-800">
          <Text className="text-white font-semibold">Build a meal</Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            className="w-10 h-10 -mr-1 rounded-full bg-zinc-900 border border-zinc-800 items-center justify-center"
          >
            <X size={20} color="#e4e4e7" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>

        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          {/* Meal name */}
          <View className="px-4 pt-4">
            <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="My usual breakfast"
              placeholderTextColor="#52525b"
              maxLength={80}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-white text-sm"
            />
          </View>

          {/* Draft items */}
          {draft.length > 0 && (
            <View className="px-4 pt-5">
              <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
                Ingredients ({draft.length})
              </Text>
              <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                {draft.map((item, i) => (
                  <View
                    key={`${item.food_name}-${i}`}
                    className="px-4 py-3 flex-row items-center"
                    style={{
                      borderBottomWidth: i === draft.length - 1 ? 0 : 1,
                      borderBottomColor: '#27272a',
                    }}
                  >
                    <View className="flex-1 pr-3">
                      <Text className="text-white text-sm" numberOfLines={1}>
                        {item.food_name}
                      </Text>
                      <Text className="text-zinc-500 text-xs mt-0.5">
                        {item.grams}g · {item.calories} kcal · {Math.round(item.protein_g)}p ·{' '}
                        {Math.round(item.carbs_g)}c · {Math.round(item.fat_g)}f
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => removeIngredient(i)}
                      hitSlop={12}
                      className="w-8 h-8 rounded-full items-center justify-center"
                    >
                      <X size={18} color="#a1a1aa" strokeWidth={2.25} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Ingredient search */}
          <View className="px-4 pt-5">
            <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
              Add ingredient
            </Text>
            <View className="flex-row items-center bg-zinc-900 border border-zinc-800 rounded-2xl px-4">
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search foods…"
                placeholderTextColor="#52525b"
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 py-3 text-white text-sm"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={12} className="w-7 h-7 rounded-full items-center justify-center">
                  <X size={16} color="#a1a1aa" strokeWidth={2.25} />
                </TouchableOpacity>
              )}
            </View>

            {debouncedQuery.length > 0 && (
              <View style={{ marginTop: 8, gap: 6 }}>
                {searchQuery.isLoading || debouncedQuery !== query.trim() ? (
                  <ActivityIndicator color="#71717a" style={{ alignSelf: 'flex-start' }} />
                ) : (searchQuery.data?.results.length ?? 0) === 0 ? (
                  <Text className="text-zinc-600 text-xs">
                    No matches. Try a simpler name (e.g. "chicken").
                  </Text>
                ) : (
                  (searchQuery.data?.results ?? []).map((r) => (
                    <SearchResultRow
                      key={r.fdc_id ?? r.name}
                      result={r}
                      onLog={(grams) => addIngredient(r, grams)}
                    />
                  ))
                )}
              </View>
            )}
          </View>
        </ScrollView>

        {/* Totals + Save pinned to the bottom */}
        <View className="px-4 pt-3 pb-8 border-t border-zinc-800 bg-black">
          <View className="flex-row items-center justify-between mb-3">
            <View>
              <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-0.5">Total</Text>
              <Text className="text-white text-xl font-bold">
                {Math.round(totals.calories)}
                <Text className="text-zinc-500 text-sm font-normal"> kcal</Text>
              </Text>
            </View>
            <Text className="text-zinc-500 text-xs">
              {Math.round(totals.protein_g)}p · {Math.round(totals.carbs_g)}c ·{' '}
              {Math.round(totals.fat_g)}f
            </Text>
          </View>
          <TouchableOpacity
            onPress={() =>
              canSave &&
              saveMutation.mutate({
                name: trimmed,
                items: draft.map((d) => ({
                  food_name: d.food_name,
                  grams: d.grams,
                  calories: d.calories,
                  protein_g: d.protein_g,
                  carbs_g: d.carbs_g,
                  fat_g: d.fat_g,
                })),
              })
            }
            disabled={!canSave}
            className="bg-white rounded-2xl py-3 items-center"
            style={{ opacity: canSave ? 1 : 0.4 }}
          >
            {saveMutation.isPending ? (
              <ActivityIndicator color="black" />
            ) : (
              <Text className="text-black font-semibold text-sm">
                Save meal{draft.length > 0 ? ` (${draft.length} items)` : ''}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

function SaveEntryAsMealModal({
  entry,
  onClose,
  onSubmit,
  busy,
}: {
  entry: NutritionEntry
  onClose: () => void
  onSubmit: (name: string) => void
  busy?: boolean
}) {
  // Pre-fill with the entry's meal_name so 'Save' is one tap when the user
  // is happy with the existing label.
  const [name, setName] = useState(entry.meal_name ?? '')
  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && trimmed.length <= 80 && !busy

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 justify-center px-6">
        <View className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5">
          <Text className="text-white text-base font-semibold mb-1">Save to favourites</Text>
          <Text className="text-zinc-500 text-xs mb-4">
            This logs one ingredient with its current macros. You can re-log it any
            time from the Saved tab.
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Name (e.g. 150g chicken)"
            placeholderTextColor="#52525b"
            autoFocus
            maxLength={80}
            className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm mb-4"
          />
          <View className="flex-row justify-end" style={{ gap: 8 }}>
            <TouchableOpacity
              onPress={onClose}
              className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800"
            >
              <Text className="text-zinc-300 text-sm">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => canSubmit && onSubmit(trimmed)}
              disabled={!canSubmit}
              className="px-4 py-2 rounded-xl bg-white"
              style={{ opacity: canSubmit ? 1 : 0.4 }}
            >
              {busy ? (
                <ActivityIndicator color="black" />
              ) : (
                <Text className="text-black text-sm font-semibold">Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function SavedMealCard({
  meal,
  onLog,
  onRename,
  onDelete,
  busy,
}: {
  meal: SavedMeal
  onLog: () => void
  onRename: () => void
  onDelete: () => void
  busy?: boolean
}) {
  const preview = meal.items.map((i) => i.food_name).join(', ')
  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3">
      <View className="flex-row items-center justify-between mb-1">
        <TouchableOpacity
          onPress={onRename}
          hitSlop={6}
          className="flex-row items-center flex-1 pr-2"
        >
          <Text className="text-white text-sm font-semibold mr-1.5" numberOfLines={1}>
            {meal.name}
          </Text>
          {/* Inline rename pencil. Smaller when the user has already named the
              meal so it doesn't compete with the title. */}
          <Text
            className="text-xs"
            style={{ color: meal.auto_generated_name ? '#fbbf24' : '#71717a' }}
          >
            ✎
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} hitSlop={12} className="w-9 h-9 rounded-full items-center justify-center">
          <MoreHorizontal size={20} color="#d4d4d8" strokeWidth={2.25} />
        </TouchableOpacity>
      </View>

      <Text className="text-zinc-500 text-xs mb-3" numberOfLines={2}>
        {preview}
      </Text>

      <View className="flex-row items-center justify-between">
        <View className="flex-row items-baseline" style={{ gap: 8 }}>
          <Text className="text-white text-sm font-semibold">
            {Math.round(meal.total_calories)}
            <Text className="text-zinc-500 text-xs font-normal"> kcal</Text>
          </Text>
          <Text className="text-zinc-600 text-xs">
            {Math.round(meal.total_protein_g)}p · {Math.round(meal.total_carbs_g)}c ·{' '}
            {Math.round(meal.total_fat_g)}f
          </Text>
        </View>
        <TouchableOpacity
          onPress={onLog}
          disabled={busy}
          className="bg-white rounded-xl px-4 py-1.5"
          style={{ opacity: busy ? 0.4 : 1 }}
        >
          <Text className="text-black text-sm font-semibold">Log</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function RenameSavedMealModal({
  meal,
  onClose,
  onSubmit,
  busy,
}: {
  meal: SavedMeal
  onClose: () => void
  onSubmit: (name: string) => void
  busy?: boolean
}) {
  const [name, setName] = useState(meal.name)
  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && trimmed.length <= 80 && !busy

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/70 justify-center px-6">
        <View className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5">
          <Text className="text-white text-base font-semibold mb-1">Rename meal</Text>
          <Text className="text-zinc-500 text-xs mb-4">
            Give this combination a name you'll recognise.
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="My usual breakfast"
            placeholderTextColor="#52525b"
            autoFocus
            maxLength={80}
            className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm mb-4"
          />
          <View className="flex-row justify-end" style={{ gap: 8 }}>
            <TouchableOpacity
              onPress={onClose}
              className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800"
            >
              <Text className="text-zinc-300 text-sm">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => canSubmit && onSubmit(trimmed)}
              disabled={!canSubmit}
              className="px-4 py-2 rounded-xl bg-white"
              style={{ opacity: canSubmit ? 1 : 0.4 }}
            >
              {busy ? (
                <ActivityIndicator color="black" />
              ) : (
                <Text className="text-black text-sm font-semibold">Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function LogModal({
  onClose,
  initialTab = 'search',
}: {
  onClose: () => void
  /** Which tab opens first. Set by the Nutrition page so each top-row
   *  button drops the user straight into the relevant view. */
  initialTab?: 'search' | 'saved' | 'photo'
}) {
  const qc = useQueryClient()

  const [tab, setTab] = useState<'search' | 'saved' | 'photo'>(initialTab)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  // Open a rename modal for a specific saved meal. null = closed.
  const [renaming, setRenaming] = useState<SavedMeal | null>(null)
  // Open the meal builder modal.
  const [building, setBuilding] = useState(false)

  // Manual fallback fields — same shape as the previous LogModal.
  const [manualName, setManualName] = useState('')
  const [manualCalories, setManualCalories] = useState('')
  const [manualProtein, setManualProtein] = useState('')
  const [manualCarbs, setManualCarbs] = useState('')
  const [manualFat, setManualFat] = useState('')

  // Debounce the search input so we don't fire a USDA call on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  // [Photo] tab is a redirect — close the modal then push the snap screen.
  useEffect(() => {
    if (tab !== 'photo') return
    onClose()
    router.push('/nutrition-snap')
  }, [tab])

  const frequentQuery = useQuery<SearchResponse>({
    queryKey: ['nutrition-frequent'],
    queryFn: () => api.get('/nutrition/frequent').then((r) => r.data),
    // Don't refetch every modal open — frequent foods barely move.
    staleTime: 5 * 60 * 1000,
  })

  const searchQuery = useQuery<SearchResponse>({
    queryKey: ['nutrition-search', debouncedQuery],
    queryFn: () =>
      api
        .get(`/nutrition/search?q=${encodeURIComponent(debouncedQuery)}`)
        .then((r) => r.data),
    enabled: debouncedQuery.length > 0,
    // Cache search results briefly so backspacing-and-retyping is instant.
    staleTime: 60 * 1000,
  })

  // Auto-detected meals — populated by the nightly scheduler. Empty for new
  // accounts until a pattern hits the 3-occurrence threshold.
  const savedMealsQuery = useQuery<SavedMealsResponse>({
    queryKey: ['saved-meals'],
    queryFn: () => api.get('/nutrition/saved-meals').then((r) => r.data),
    enabled: tab === 'saved',
    staleTime: 60 * 1000,
  })

  // Re-log a saved meal: creates N NutritionLog rows server-side, one per item.
  const logSavedMealMutation = useMutation({
    mutationFn: (mealId: string) =>
      api.post(`/nutrition/saved-meals/${mealId}/log`).then((r) => r.data),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['nutrition-today'] })
    },
    onError: (err: any) => {
      Alert.alert("Couldn't log meal", err?.response?.data?.detail ?? 'Try again')
    },
  })

  const deleteSavedMealMutation = useMutation({
    mutationFn: (mealId: string) => api.delete(`/nutrition/saved-meals/${mealId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-meals'] })
    },
  })

  const renameSavedMealMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(`/nutrition/saved-meals/${id}`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-meals'] })
      setRenaming(null)
    },
    onError: (err: any) => {
      Alert.alert("Couldn't rename", err?.response?.data?.detail ?? 'Try again')
    },
  })

  function confirmDeleteSavedMeal(meal: SavedMeal) {
    Alert.alert(
      'Delete saved meal?',
      `"${meal.name}" won't auto-resurface from the same combination of foods.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteSavedMealMutation.mutate(meal.id),
        },
      ],
    )
  }

  const showFrequent = debouncedQuery.length === 0
  const results = showFrequent
    ? frequentQuery.data?.results ?? []
    : searchQuery.data?.results ?? []
  const sectionTitle = showFrequent ? 'Frequent' : 'Results'
  // Show loading whenever (a) the relevant query is loading, OR (b) the user
  // has typed but the debounce hasn't fired yet — otherwise the previous
  // results stay visible during the gap and look wrong.
  const isLoading = showFrequent
    ? frequentQuery.isLoading
    : searchQuery.isLoading || debouncedQuery !== query.trim()

  const logMutation = useMutation({
    mutationFn: (body: object) => api.post('/nutrition/log', body),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['nutrition-today'] })
    },
  })

  function logFromResult(r: SearchResult, grams: number) {
    const factor = grams / 100
    logMutation.mutate({
      meal_name: r.logged_name ?? r.name,
      calories: Math.round(r.per_100g.calories * factor),
      protein_g: Math.round(r.per_100g.protein_g * factor * 10) / 10,
      carbs_g: Math.round(r.per_100g.carbs_g * factor * 10) / 10,
      fat_g: Math.round(r.per_100g.fat_g * factor * 10) / 10,
      source: 'manual',
    })
  }

  const hasManualValue =
    !!manualCalories || !!manualProtein || !!manualCarbs || !!manualFat

  // Estimate kcal from macros when calories is empty (matches the prior UX).
  const estimatedCals =
    !manualCalories && (manualProtein || manualCarbs || manualFat)
      ? Math.round(
          parseFloat(manualProtein || '0') * 4 +
            parseFloat(manualCarbs || '0') * 4 +
            parseFloat(manualFat || '0') * 9,
        )
      : null

  function handleManualLog() {
    if (!hasManualValue) return
    logMutation.mutate(
      {
        meal_name: manualName.trim() || null,
        calories: manualCalories ? parseInt(manualCalories, 10) : null,
        protein_g: manualProtein ? parseFloat(manualProtein) : null,
        carbs_g: manualCarbs ? parseFloat(manualCarbs) : null,
        fat_g: manualFat ? parseFloat(manualFat) : null,
        source: 'manual',
      },
      {
        onSuccess: () => {
          setManualName('')
          setManualCalories('')
          setManualProtein('')
          setManualCarbs('')
          setManualFat('')
          onClose()
        },
      },
    )
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
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            className="w-10 h-10 -mr-1 rounded-full bg-zinc-900 border border-zinc-800 items-center justify-center"
          >
            <X size={20} color="#e4e4e7" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>

        {/* Search / Saved / Photo top toggle. Photo just hands off to the
            existing snap screen via the useEffect above. */}
        <View className="px-4 pt-3">
          <View className="flex-row bg-zinc-900 border border-zinc-800 rounded-2xl p-1">
            {(['search', 'saved', 'photo'] as const).map((t) => {
              const active = tab === t
              return (
                <TouchableOpacity
                  key={t}
                  onPress={() => setTab(t)}
                  className="flex-1 py-2 items-center rounded-xl"
                  style={{ backgroundColor: active ? '#27272a' : 'transparent' }}
                >
                  <Text
                    className="text-xs font-medium capitalize"
                    style={{ color: active ? 'white' : '#71717a' }}
                  >
                    {t}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          {tab === 'search' && (
            <>
              {/* Search bar. The mic hint points users at the platform
                  keyboard's built-in dictation — no native speech-recognition
                  dependency required. When the field is empty we surface it as
                  a quiet helper line; it disappears as soon as the user starts
                  typing. */}
              <View className="px-4 pt-3">
                <View className="flex-row items-center bg-zinc-900 border border-zinc-800 rounded-2xl px-4">
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search foods…"
                    placeholderTextColor="#52525b"
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="flex-1 py-3 text-white text-sm"
                  />
                  {query.length > 0 && (
                    <TouchableOpacity onPress={() => setQuery('')} hitSlop={12} className="w-7 h-7 rounded-full items-center justify-center">
                      <X size={16} color="#a1a1aa" strokeWidth={2.25} />
                    </TouchableOpacity>
                  )}
                </View>
                {query.length === 0 && (
                  <Text className="text-zinc-600 text-[10px] mt-1.5 pl-1">
                    🎤 Tap your keyboard's mic to dictate
                  </Text>
                )}
              </View>

              {/* Results / frequent section */}
              <Text className="px-4 pt-4 pb-2 text-zinc-500 text-xs uppercase tracking-widest">
                {sectionTitle}
              </Text>

              {isLoading ? (
                <View className="px-4 py-4 items-start">
                  <ActivityIndicator color="#71717a" />
                </View>
              ) : results.length === 0 ? (
                <View className="px-4 py-6">
                  <Text className="text-zinc-600 text-xs">
                    {showFrequent
                      ? 'No frequent foods yet. Search above or add manually below.'
                      : 'No matches. Try a simpler name (e.g. “chicken”).'}
                  </Text>
                </View>
              ) : (
                <View className="px-4" style={{ gap: 6 }}>
                  {results.map((r) => (
                    <SearchResultRow
                      key={r.fdc_id ?? r.name}
                      result={r}
                      onLog={(grams) => logFromResult(r, grams)}
                      busy={logMutation.isPending}
                    />
                  ))}
                </View>
              )}

              {/* Manual fallback — visible at the bottom of the Search tab. */}
              <View className="px-4 pt-7">
                <View className="h-px bg-zinc-800 mb-5" />
                <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
                  Add manually
                </Text>
                <TextInput
                  value={manualName}
                  onChangeText={setManualName}
                  placeholder="What you ate"
                  placeholderTextColor="#52525b"
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-white text-sm mb-3"
                />

                <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-1.5">
                  Calories
                </Text>
                <TextInput
                  value={manualCalories}
                  onChangeText={setManualCalories}
                  placeholder={estimatedCals ? `~${estimatedCals} (estimated)` : 'e.g. 450'}
                  placeholderTextColor="#52525b"
                  keyboardType="number-pad"
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-white text-sm mb-3"
                />

                <View className="flex-row gap-2 mb-2">
                  {[
                    { label: 'Protein', value: manualProtein, set: setManualProtein, color: '#818cf8' },
                    { label: 'Carbs', value: manualCarbs, set: setManualCarbs, color: '#34d399' },
                    { label: 'Fat', value: manualFat, set: setManualFat, color: '#fbbf24' },
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
                  <TouchableOpacity
                    onPress={() => setManualCalories(String(estimatedCals))}
                    className="mb-3"
                  >
                    <Text className="text-zinc-400 text-xs underline">
                      Use ~{estimatedCals} kcal estimated from macros
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  onPress={handleManualLog}
                  disabled={!hasManualValue || logMutation.isPending}
                  className="bg-white rounded-2xl py-3 items-center mt-1"
                  style={{ opacity: !hasManualValue || logMutation.isPending ? 0.4 : 1 }}
                >
                  {logMutation.isPending ? (
                    <ActivityIndicator color="black" />
                  ) : (
                    <Text className="text-black font-semibold text-sm">Log manually</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}

          {tab === 'saved' && (() => {
            const allMeals = savedMealsQuery.data?.meals ?? []
            const myMeals = allMeals.filter((m) => m.source === 'manual')
            const suggested = allMeals.filter((m) => m.source === 'auto')

            return (
              <View className="px-4 pt-4">
                {/* + Build meal sits at the top so it's the obvious primary
                    action even when the user has zero saved meals. */}
                <TouchableOpacity
                  onPress={() => setBuilding(true)}
                  className="bg-zinc-900 border border-dashed border-zinc-700 rounded-2xl py-4 items-center mb-3"
                >
                  <Text className="text-white text-sm font-semibold">+ Build meal</Text>
                  <Text className="text-zinc-500 text-[11px] mt-0.5">
                    Search ingredients, set portions, save as a meal
                  </Text>
                </TouchableOpacity>

                {savedMealsQuery.isLoading ? (
                  <ActivityIndicator color="#71717a" />
                ) : allMeals.length === 0 ? (
                  <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                    <Text className="text-white text-sm font-medium mb-1">
                      No saved meals yet
                    </Text>
                    <Text className="text-zinc-500 text-xs leading-5">
                      Tap <Text className="text-white">+ Build meal</Text> to compose one, or
                      swipe right on a logged ingredient on the Nutrition page to save it.
                    </Text>
                  </View>
                ) : (
                  <>
                    {/* My meals — manual */}
                    {myMeals.length > 0 && (
                      <>
                        <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2 mt-1">
                          My meals
                        </Text>
                        <View style={{ gap: 8 }}>
                          {myMeals.map((meal) => (
                            <SavedMealCard
                              key={meal.id}
                              meal={meal}
                              onLog={() => logSavedMealMutation.mutate(meal.id)}
                              onRename={() => setRenaming(meal)}
                              onDelete={() => confirmDeleteSavedMeal(meal)}
                              busy={logSavedMealMutation.isPending}
                            />
                          ))}
                        </View>
                      </>
                    )}

                    {/* Suggested by PeakForm — auto-detected. Hidden when empty
                        so a brand-new user only sees the manual section. */}
                    {suggested.length > 0 && (
                      <>
                        <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2 mt-5">
                          Suggested by PeakForm
                        </Text>
                        <View style={{ gap: 8 }}>
                          {suggested.map((meal) => (
                            <SavedMealCard
                              key={meal.id}
                              meal={meal}
                              onLog={() => logSavedMealMutation.mutate(meal.id)}
                              onRename={() => setRenaming(meal)}
                              onDelete={() => confirmDeleteSavedMeal(meal)}
                              busy={logSavedMealMutation.isPending}
                            />
                          ))}
                        </View>
                      </>
                    )}
                  </>
                )}
              </View>
            )
          })()}
        </ScrollView>
      </View>

      {renaming && (
        <RenameSavedMealModal
          meal={renaming}
          onClose={() => setRenaming(null)}
          onSubmit={(name) => renameSavedMealMutation.mutate({ id: renaming.id, name })}
          busy={renameSavedMealMutation.isPending}
        />
      )}

      {building && (
        <BuildMealModal
          onClose={() => setBuilding(false)}
          onSaved={() => {
            setBuilding(false)
            qc.invalidateQueries({ queryKey: ['saved-meals'] })
          }}
        />
      )}
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
  // Drives which tab the LogModal opens to. The top-row Search/Saved buttons
  // set this before opening; Photo bypasses the modal and routes directly
  // to the snap screen.
  const [logInitialTab, setLogInitialTab] = useState<'search' | 'saved'>('search')
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

  // The swipe-right "Save" action on each entry opens this modal pre-filled
  // with that entry's foods + macros. Submit posts to POST /nutrition/saved-meals.
  const [savingEntry, setSavingEntry] = useState<NutritionEntry | null>(null)

  const saveAsMealMutation = useMutation({
    mutationFn: (body: { name: string; items: object[] }) =>
      api.post('/nutrition/saved-meals', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-meals'] })
      setSavingEntry(null)
    },
    onError: (err: any) => {
      Alert.alert("Couldn't save", err?.response?.data?.detail ?? 'Try again')
    },
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
        <View className="pt-6 pb-4">
          <Text className="text-zinc-400 text-xs uppercase tracking-widest font-semibold">{today}</Text>
          <Text className="text-white text-3xl font-bold mt-1.5">Nutrition</Text>
        </View>

        {/* Top-row log actions — Search / Saved / Photo are equal-prominence
            on-page buttons. Search + Saved open LogModal pre-set to that tab;
            Photo routes straight to the snap screen, skipping the modal. */}
        <View className="flex-row mb-5" style={{ gap: 8 }}>
          <PressableScale
            haptic
            onPress={() => {
              setLogInitialTab('search')
              setShowLog(true)
            }}
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl py-4 items-center"
            style={{ gap: 6 }}
          >
            <SearchIcon size={18} color="#ffffff" strokeWidth={2} />
            <Text className="text-white text-sm font-semibold">Search</Text>
          </PressableScale>

          <PressableScale
            haptic
            onPress={() => {
              setLogInitialTab('saved')
              setShowLog(true)
            }}
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl py-4 items-center"
            style={{ gap: 6 }}
          >
            <Bookmark size={18} color="#ffffff" strokeWidth={2} />
            <Text className="text-white text-sm font-semibold">Saved</Text>
          </PressableScale>

          <PressableScale
            haptic
            onPress={() => router.push('/nutrition-snap')}
            className="flex-1 bg-white rounded-2xl py-4 items-center"
            style={{ gap: 6 }}
          >
            <Camera size={18} color="#000000" strokeWidth={2} />
            <Text className="text-black text-sm font-semibold">Photo</Text>
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
                  onPress={() => {
                    setLogInitialTab('search')
                    setShowLog(true)
                  }}
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
                    onSave={() => setSavingEntry(entry)}
                    saveLabel="Save"
                  >
                    <EntryRow entry={entry} isLast={i === entries.length - 1} />
                  </SwipeableRow>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {showLog && (
        <LogModal
          initialTab={logInitialTab}
          onClose={() => setShowLog(false)}
        />
      )}

      {savingEntry && (
        <SaveEntryAsMealModal
          entry={savingEntry}
          onClose={() => setSavingEntry(null)}
          onSubmit={(name) =>
            saveAsMealMutation.mutate({
              name,
              items: [
                {
                  food_name: savingEntry.meal_name ?? name,
                  grams: null,
                  calories: savingEntry.calories ?? 0,
                  protein_g: savingEntry.protein_g ?? 0,
                  carbs_g: savingEntry.carbs_g ?? 0,
                  fat_g: savingEntry.fat_g ?? 0,
                },
              ],
            })
          }
          busy={saveAsMealMutation.isPending}
        />
      )}
    </SafeAreaView>
  )
}