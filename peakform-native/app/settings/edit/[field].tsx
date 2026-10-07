import { useState } from 'react'
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore, type User } from '../../../store/auth'
import { offerCalorieRecompute, useUpdateMe } from '../../../hooks/useUpdateMe'
import { extractErrorMessage } from '../../../lib/apiError'
import { useUnits, type Units } from '../../../lib/units'
import { colors } from '../../../theme/tokens'

// One value, edited in a modal with Cancel/Done (DESIGN.md §5, §6). Saves on
// Done; a server rejection shows inline and keeps the sheet open.

type Field = 'username' | 'age' | 'height' | 'calories' | 'protein' | 'water'

const USERNAME_RE = /^[a-z0-9_]{3,24}$/

interface Spec {
  title: string
  unit?: (u: Units) => string
  footer?: string
  /** Seed text from the stored user. */
  initial: (user: User, u: Units) => string
  /** Parsed payload, or an error message. */
  parse: (text: string, u: Units, extra: string) => Partial<User> | string
}

function int(text: string): number | null {
  const n = parseInt(text.replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

const SPECS: Record<Field, Spec> = {
  username: {
    title: 'Username',
    footer: '3–24 characters: lowercase letters, numbers and underscores.',
    initial: (user) => user.username ?? '',
    parse: (t) => (USERNAME_RE.test(t) ? { username: t } : '3–24 characters: lowercase letters, numbers and underscores.'),
  },
  age: {
    title: 'Age',
    unit: () => 'years',
    initial: (user) => (user.age != null ? String(user.age) : ''),
    parse: (t) => {
      const n = int(t)
      return n != null && n >= 13 && n <= 100 ? { age: n } : 'Enter an age between 13 and 100.'
    },
  },
  height: {
    title: 'Height',
    unit: (u) => (u.system === 'imperial' ? 'ft' : 'cm'),
    initial: (user, u) => {
      if (user.height_cm == null) return ''
      const h = u.height(user.height_cm)
      return u.system === 'imperial' ? String(Math.floor(h / 12)) : String(h)
    },
    parse: (t, u, extra) => {
      if (u.system === 'imperial') {
        const ft = int(t)
        const inch = extra.trim() ? int(extra) : 0
        if (ft == null || inch == null || ft < 3 || ft > 8 || inch > 11) return 'Enter feet (3–8) and inches (0–11).'
        return { height_cm: u.heightToCm(ft * 12 + inch) }
      }
      const cm = int(t)
      return cm != null && cm >= 100 && cm <= 250 ? { height_cm: cm } : 'Enter a height between 100 and 250 cm.'
    },
  },
  calories: {
    title: 'Calories',
    unit: () => 'kcal',
    footer: 'Your daily calorie target.',
    initial: (user) => (user.calorie_target != null ? String(user.calorie_target) : ''),
    parse: (t) => {
      const n = int(t)
      return n != null && n >= 800 && n <= 6000 ? { calorie_target: n } : 'Enter between 800 and 6,000 kcal.'
    },
  },
  protein: {
    title: 'Protein',
    unit: () => 'g',
    footer: 'Your daily protein target. A common starting point is 2 g per kg of bodyweight.',
    initial: (user) => (user.protein_target_g != null ? String(Math.round(user.protein_target_g)) : ''),
    parse: (t) => {
      const n = int(t)
      return n != null && n >= 20 && n <= 400 ? { protein_target_g: n } : 'Enter between 20 and 400 g.'
    },
  },
  water: {
    title: 'Water',
    unit: (u) => u.waterUnit,
    footer: 'Your daily water target.',
    initial: (user, u) => (user.water_target_ml != null ? String(u.water(user.water_target_ml)) : ''),
    parse: (t, u) => {
      const n = int(t)
      const ml = n != null ? u.waterToMl(n) : null
      return ml != null && ml >= 500 && ml <= 8000
        ? { water_target_ml: ml }
        : `Enter between ${u.water(500)} and ${u.water(8000)} ${u.waterUnit}.`
    },
  },
}

/** Changing these moves the calorie estimate. */
const RECOMPUTE: Field[] = ['age', 'height']

export default function EditValueScreen() {
  const { field } = useLocalSearchParams<{ field: Field }>()
  const spec = SPECS[field] ?? SPECS.username
  const user = useAuthStore((s) => s.user)
  const u = useUnits()
  const qc = useQueryClient()
  const update = useUpdateMe()

  const [text, setText] = useState(() => (user ? spec.initial(user, u) : ''))
  const [extra, setExtra] = useState(() =>
    field === 'height' && u.system === 'imperial' && user?.height_cm != null ? String(u.height(user.height_cm) % 12) : '',
  )
  const [error, setError] = useState<string | null>(null)

  function done() {
    const parsed = spec.parse(text.trim(), u, extra)
    if (typeof parsed === 'string') {
      setError(parsed)
      return
    }
    setError(null)
    update.mutate(parsed, {
      onSuccess: (updated) => {
        if (!RECOMPUTE.includes(field)) return router.back()
        offerCalorieRecompute(
          updated,
          qc,
          (kcal) => update.mutate({ calorie_target: kcal }, { onSettled: () => router.back() }),
          () => router.back(),
        )
      },
      onError: (e: any) =>
        setError(e?.response?.status === 409 ? 'That username is taken.' : extractErrorMessage(e, "Couldn't save. Try again.")),
    })
  }

  const imperialHeight = field === 'height' && u.system === 'imperial'
  const numeric = field !== 'username'

  return (
    <>
      <Stack.Screen
        options={{
          title: spec.title,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="py-2">
              <Text className="text-text text-body">Cancel</Text>
            </TouchableOpacity>
          ),
          headerRight: () =>
            update.isPending ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <TouchableOpacity onPress={done} hitSlop={12} className="py-2">
                <Text className="text-text text-body font-semibold">Done</Text>
              </TouchableOpacity>
            ),
        }}
      />
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} className="flex-1 bg-surface" contentContainerClassName="px-4 pt-6 pb-12" keyboardShouldPersistTaps="handled">
        <View className="flex-row gap-3">
          <Field
            value={text}
            onChangeText={(v) => {
              setText(field === 'username' ? v.replace(/^@/, '').toLowerCase() : v)
              setError(null)
            }}
            unit={spec.unit?.(u)}
            prefix={field === 'username' ? '@' : undefined}
            numeric={numeric}
            onSubmit={done}
            autoFocus
          />
          {imperialHeight && (
            <Field
              value={extra}
              onChangeText={(v) => {
                setExtra(v)
                setError(null)
              }}
              unit="in"
              numeric
              onSubmit={done}
            />
          )}
        </View>
        {error ? (
          <Text className="text-danger text-footnote mt-2 px-4">{error}</Text>
        ) : spec.footer ? (
          <Text className="text-text-subtle text-footnote mt-2 px-4">{spec.footer}</Text>
        ) : null}
      </ScrollView>
    </>
  )
}

function Field({
  value,
  onChangeText,
  unit,
  prefix,
  numeric,
  onSubmit,
  autoFocus,
}: {
  value: string
  onChangeText: (v: string) => void
  unit?: string
  prefix?: string
  numeric: boolean
  onSubmit: () => void
  autoFocus?: boolean
}) {
  return (
    <View
      className="flex-1 flex-row items-center bg-surface-raised border border-border rounded-md px-4"
      style={{ borderCurve: 'continuous' }}
    >
      {prefix && <Text className="text-text-subtle text-body">{prefix}</Text>}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={numeric ? 'number-pad' : 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        maxLength={numeric ? 5 : 24}
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        placeholderTextColor={colors['text-subtle']}
        className="flex-1 py-3 text-text text-body"
      />
      {unit && <Text className="text-text-subtle text-body ml-2">{unit}</Text>}
    </View>
  )
}
