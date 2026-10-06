import { useMemo, useRef, useState } from 'react'
import { capitalize } from '../lib/format'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Keyboard, X } from 'lucide-react-native'
import { api } from '../api/client'
import { PressableScale } from '../components/PressableScale'
import { hapticMedium, hapticSuccess } from '../lib/haptics'
import { extractErrorMessage } from '../lib/apiError'
import { colors } from '../theme/tokens'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Per100 {
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

// GET /nutrition/barcode/{code} (backend/services/openfoodfacts.py).
interface Product {
  barcode: string
  name: string
  brand: string | null
  // Null when Open Food Facts has the product but no nutrition for it.
  per_100g: Per100 | null
  unit: 'g' | 'ml'
  serving_qty: number | null
  package_qty: number | null
  image_url: string | null
}

// What the review step shows. `known` is false when the code wasn't in the
// database, so the user fills the name in too.
type Found = { product: Product; known: boolean }

// UPC-E is left out: its check digit is computed over the expanded UPC-A,
// which the backend's GTIN check doesn't do. It's rare outside small US items.
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a'] as const

// ─── Permission Gate ──────────────────────────────────────────────────────────

function PermissionGate({
  onRequest,
  canAskAgain,
  onType,
}: {
  onRequest: () => void
  canAskAgain: boolean
  onType: () => void
}) {
  return (
    <View className="flex-1 bg-bg items-center justify-center px-8">
      <Text className="text-text text-headline font-semibold text-center mb-2">
        Camera access needed
      </Text>
      <Text className="text-text-muted text-footnote text-center mb-8">
        {canAskAgain
          ? 'GainRace uses the camera to read the barcode on packaged food.'
          : 'Camera was denied. Open Settings to allow camera access for GainRace, or type the barcode number instead.'}
      </Text>
      <PressableScale
        haptic
        onPress={canAskAgain ? onRequest : () => Linking.openSettings()}
        className="bg-accent rounded-md px-6 py-3" style={{ borderCurve: 'continuous' }}
      >
        <Text className="text-on-accent font-semibold">
          {canAskAgain ? 'Allow camera' : 'Open Settings'}
        </Text>
      </PressableScale>
      <TouchableOpacity onPress={onType} hitSlop={12} className="mt-4 px-4 py-3">
        <Text className="text-text-muted text-body font-medium">Type the number</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="px-4 py-3">
        <Text className="text-text-subtle text-body">Cancel</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Typed entry ──────────────────────────────────────────────────────────────

function TypeCodePanel({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean
  onSubmit: (code: string) => void
  onCancel: () => void
}) {
  const [code, setCode] = useState('')
  const digits = code.replace(/\D/g, '')
  const canSubmit = [8, 12, 13, 14].includes(digits.length) && !busy

  return (
    <View className="bg-surface border-t border-divider px-4 pt-4 pb-6">
      <Text className="text-text-subtle text-caption mb-2">
        Barcode number
      </Text>
      <View className="flex-row gap-2">
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="e.g. 5941234567890"
          placeholderTextColor={colors['text-subtle']}
          keyboardType="number-pad"
          autoFocus
          maxLength={17}
          returnKeyType="search"
          onSubmitEditing={() => canSubmit && onSubmit(digits)}
          className="flex-1 bg-surface-raised border border-border rounded-md px-4 py-3 text-text text-body"
          style={{ borderCurve: 'continuous', letterSpacing: 1 }}
        />
        <PressableScale
          haptic
          onPress={() => onSubmit(digits)}
          disabled={!canSubmit}
          className="bg-accent rounded-md px-5 items-center justify-center"
          style={{ borderCurve: 'continuous', opacity: canSubmit ? 1 : 0.4 }}
        >
          {busy ? (
            <ActivityIndicator color={colors['on-accent']} />
          ) : (
            <Text className="text-on-accent font-semibold">Look up</Text>
          )}
        </PressableScale>
      </View>
      <TouchableOpacity onPress={onCancel} hitSlop={12} className="mt-3 self-center px-4 py-2">
        <Text className="text-text-muted text-footnote">Back to scanning</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Review ───────────────────────────────────────────────────────────────────

function num(s: string): number {
  const n = parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function fmtQty(q: number) {
  return Number.isInteger(q) ? String(q) : q.toFixed(1)
}

function MacroCell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View className="flex-1 items-center">
      <Text className="text-text-subtle text-caption mb-1">{label}</Text>
      <Text className="text-body font-semibold" style={{ color }}>
        {Math.round(value)}g
      </Text>
    </View>
  )
}

function LabelField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <View className="flex-1">
      <Text className="text-text-subtle text-caption mb-1">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={colors['text-subtle']}
        className="bg-surface-raised border border-border rounded-md px-3 py-3 text-text text-footnote" style={{ borderCurve: 'continuous' }}
      />
    </View>
  )
}

function ReviewProduct({ found, onRescan }: { found: Found; onRescan: () => void }) {
  const qc = useQueryClient()
  const { product, known } = found
  const unit = product.unit

  // The values to scale. From the database when it has them, otherwise typed
  // off the label's "per 100 g" column.
  const [name, setName] = useState(known ? product.name : '')
  const [label, setLabel] = useState({ calories: '', protein_g: '', carbs_g: '', fat_g: '' })
  const per100: Per100 = product.per_100g ?? {
    calories: num(label.calories),
    protein_g: num(label.protein_g),
    carbs_g: num(label.carbs_g),
    fat_g: num(label.fat_g),
  }

  // Portion presets. A serving is the best default; failing that 100 g, since
  // a whole pack is often several portions (a 1 kg bag of rice).
  const presets = useMemo(() => {
    const out: { label: string; qty: number }[] = []
    if (product.serving_qty) {
      out.push({ label: `1 serving · ${fmtQty(product.serving_qty)}${unit}`, qty: product.serving_qty })
    }
    if (product.package_qty && product.package_qty !== product.serving_qty) {
      out.push({ label: `Whole pack · ${fmtQty(product.package_qty)}${unit}`, qty: product.package_qty })
    }
    if (product.serving_qty !== 100 && product.package_qty !== 100) {
      out.push({ label: `100${unit}`, qty: 100 })
    }
    return out
  }, [product, unit])
  const [amount, setAmount] = useState(fmtQty(product.serving_qty ?? 100))
  const qty = num(amount)
  const f = qty / 100
  const totals = {
    calories: per100.calories * f,
    protein_g: per100.protein_g * f,
    carbs_g: per100.carbs_g * f,
    fat_g: per100.fat_g * f,
  }

  const { mutate, isPending } = useMutation({
    mutationFn: (body: object) => api.post('/nutrition/log', body),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['nutrition-today'] })
      router.back()
    },
    onError: (err: any) => {
      Alert.alert("Couldn't log food", extractErrorMessage(err, 'Please try again.'))
    },
  })

  const hasValues = per100.calories > 0 || per100.protein_g > 0 || per100.carbs_g > 0 || per100.fat_g > 0
  const canLog = qty > 0 && hasValues && name.trim().length > 0 && !isPending

  function handleLog() {
    if (!canLog) return
    mutate({
      meal_name: name.trim(),
      calories: Math.round(totals.calories),
      protein_g: Math.round(totals.protein_g * 10) / 10,
      carbs_g: Math.round(totals.carbs_g * 10) / 10,
      fat_g: Math.round(totals.fat_g * 10) / 10,
      source: 'barcode',
    })
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-divider">
        <TouchableOpacity
          onPress={onRescan}
          hitSlop={12}
          className="-ml-1 px-2 py-2 flex-row items-center gap-1"
        >
          <ChevronLeft size={22} color={colors.text} strokeWidth={2.25} />
          <Text className="text-text-muted text-body font-medium">Rescan</Text>
        </TouchableOpacity>
        <Text className="text-text font-semibold">Review food</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="p-4 pb-12 gap-5"
        keyboardShouldPersistTaps="handled"
      >
        {/* Product */}
        {known ? (
          <View className="flex-row items-center gap-4">
            {product.image_url ? (
              <View className="bg-surface rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
                <Image
                  source={{ uri: product.image_url }}
                  style={{ width: 64, height: 64 }}
                  resizeMode="contain"
                />
              </View>
            ) : null}
            <View className="flex-1">
              <Text className="text-text text-headline font-semibold" numberOfLines={2}>
                {capitalize(product.name)}
              </Text>
              {product.brand ? (
                <Text className="text-text-subtle text-footnote" numberOfLines={1}>
                  {product.brand}
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <View>
            <Text className="text-text text-body font-semibold mb-1">
              Not in the food database yet
            </Text>
            <Text className="text-text-subtle text-footnote mb-3">
              Barcode {product.barcode}. Name it and copy the values from the label.
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Product name"
              placeholderTextColor={colors['text-subtle']}
              className="bg-surface-raised border border-border rounded-md px-4 py-3 text-text text-body" style={{ borderCurve: 'continuous' }}
            />
          </View>
        )}

        {/* Label values, when the database has none */}
        {!product.per_100g && (
          <View>
            <Text className="text-text-subtle text-caption mb-2">
              Per 100{unit} on the label
            </Text>
            {known && (
              <Text className="text-text-subtle text-caption mb-2">
                The database has this product but no nutrition values for it.
              </Text>
            )}
            <View className="flex-row gap-2">
              <LabelField label="kcal" value={label.calories} onChange={(v) => setLabel({ ...label, calories: v })} />
              <LabelField label="Protein g" value={label.protein_g} onChange={(v) => setLabel({ ...label, protein_g: v })} />
              <LabelField label="Carbs g" value={label.carbs_g} onChange={(v) => setLabel({ ...label, carbs_g: v })} />
              <LabelField label="Fat g" value={label.fat_g} onChange={(v) => setLabel({ ...label, fat_g: v })} />
            </View>
          </View>
        )}

        {/* Amount */}
        <View>
          <Text className="text-text-subtle text-caption mb-2">
            How much did you have?
          </Text>
          <View className="flex-row items-center bg-surface-raised border border-border rounded-md px-4" style={{ borderCurve: 'continuous' }}>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              selectTextOnFocus
              className="flex-1 py-3 text-text text-title font-semibold"
            />
            <Text className="text-text-muted text-body">{unit}</Text>
          </View>
          <View className="flex-row flex-wrap mt-2 gap-2">
            {presets.map((p) => {
              const active = qty === p.qty
              return (
                <TouchableOpacity
                  key={p.label}
                  onPress={() => setAmount(fmtQty(p.qty))}
                  className="rounded-full px-3 py-2 border"
                  style={{
                    borderCurve: 'continuous',
                    backgroundColor: active ? colors.text : colors.surface,
                    borderColor: active ? colors.text : colors.border,
                  }}
                >
                  <Text className="text-caption font-medium" style={{ color: active ? colors.bg : colors['text-muted'] }}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        {/* Totals */}
        <View className="bg-surface border border-divider rounded-xl p-4" style={{ borderCurve: 'continuous' }}>
          <View className="flex-row items-baseline gap-2">
            <Text className="text-text text-display font-bold">{Math.round(totals.calories)}</Text>
            <Text className="text-text-subtle text-footnote">kcal</Text>
          </View>
          <View className="flex-row mt-3">
            <MacroCell label="Protein" value={totals.protein_g} color={colors.data.protein} />
            <MacroCell label="Carbs" value={totals.carbs_g} color={colors.data.carbs} />
            <MacroCell label="Fat" value={totals.fat_g} color={colors.data.fat} />
          </View>
          {product.per_100g && (
            <Text className="text-text-subtle text-caption mt-3">
              {product.per_100g.calories} kcal per 100{unit} · Open Food Facts
            </Text>
          )}
        </View>

        <PressableScale
          haptic
          onPress={handleLog}
          disabled={!canLog}
          className="bg-accent rounded-md py-4 items-center"
          style={{ borderCurve: 'continuous', opacity: canLog ? 1 : 0.4 }}
        >
          {isPending ? (
            <ActivityIndicator color={colors['on-accent']} />
          ) : (
            <Text className="text-on-accent font-semibold text-body">Log food</Text>
          )}
        </PressableScale>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NutritionBarcodeScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const [typing, setTyping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<Found | null>(null)
  // onBarcodeScanned fires every frame the code is in view; state updates
  // land too late to stop the duplicates, so the lock is a ref.
  const locked = useRef(false)

  async function lookup(code: string) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    try {
      const { data } = await api.get<Product>(`/nutrition/barcode/${code}`)
      hapticSuccess()
      setFound({ product: data, known: true })
    } catch (err: any) {
      if (err?.response?.status === 404) {
        hapticMedium()
        setFound({
          known: false,
          product: {
            barcode: code,
            name: '',
            brand: null,
            per_100g: null,
            unit: 'g',
            serving_qty: null,
            package_qty: null,
            image_url: null,
          },
        })
      } else {
        Alert.alert(
          "Couldn't look that up",
          extractErrorMessage(err, 'Try again, or log the food by hand.'),
          [{ text: 'OK', onPress: () => { locked.current = false } }],
        )
      }
    } finally {
      setBusy(false)
    }
  }

  function rescan() {
    setFound(null)
    setTyping(false)
    locked.current = false
  }

  if (found) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ReviewProduct found={found} onRescan={rescan} />
      </SafeAreaView>
    )
  }

  if (!permission) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }

  // Without the camera the typed entry is the whole screen.
  if (!permission.granted) {
    return typing ? (
      <SafeAreaView className="flex-1 bg-bg justify-end" edges={['top', 'bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TypeCodePanel busy={busy} onSubmit={lookup} onCancel={() => router.back()} />
        </KeyboardAvoidingView>
      </SafeAreaView>
    ) : (
      <PermissionGate
        onRequest={requestPermission}
        canAskAgain={permission.canAskAgain}
        onType={() => setTyping(true)}
      />
    )
  }

  function handleScanned(result: BarcodeScanningResult) {
    if (locked.current || typing) return
    const code = result.data.replace(/\D/g, '')
    if (![8, 12, 13, 14].includes(code.length)) return
    hapticMedium()
    lookup(code)
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="flex-1">
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
            onBarcodeScanned={busy || typing ? undefined : handleScanned}
          />

          {/* Aim box */}
          <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
            <View
              className="rounded-xl"
              style={{ borderCurve: 'continuous', width: '78%', height: 150, borderWidth: 2, borderColor: `${colors.text}d9` }}
            />
          </View>

          {/* Top bar */}
          <View className="absolute top-0 left-0 right-0 px-4 pt-3 flex-row items-center justify-between">
            <TouchableOpacity
              onPress={() => router.back()}
              className="w-11 h-11 rounded-full bg-bg/60 items-center justify-center" style={{ borderCurve: 'continuous' }}
              hitSlop={12}
            >
              <X size={22} color={colors.text} strokeWidth={2.25} />
            </TouchableOpacity>
            <View className="bg-bg/60 rounded-full px-3 py-2" style={{ borderCurve: 'continuous' }}>
              <Text className="text-text text-caption">Point at the barcode</Text>
            </View>
            <View style={{ width: 44 }} />
          </View>

          {busy && (
            <View className="absolute inset-0 bg-bg/70 items-center justify-center">
              <ActivityIndicator color={colors.text} />
              <Text className="text-text text-footnote mt-3">Looking up product…</Text>
            </View>
          )}
        </View>

        {typing ? (
          <TypeCodePanel busy={busy} onSubmit={lookup} onCancel={() => setTyping(false)} />
        ) : (
          <View className="items-center pt-4 pb-6">
            <TouchableOpacity
              onPress={() => setTyping(true)}
              className="flex-row items-center bg-surface border border-divider rounded-full px-4 py-3 gap-2" style={{ borderCurve: 'continuous' }}
            >
              <Keyboard size={16} color={colors.text} strokeWidth={2} />
              <Text className="text-text text-footnote font-medium">Type the number</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
