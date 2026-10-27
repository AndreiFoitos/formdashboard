import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, TextInput } from 'react-native'
import { Plus, X } from 'lucide-react-native'
import type {
  Cooking,
  DietStyle,
  Equipment,
  Experience,
  HealthFlag,
  Preferences,
} from '../../hooks/usePreferences'
import { colors } from '../../theme/tokens'

// The Training and Food answers Pit Crew builds plans from. Shared by the
// onboarding steps and the Settings → Training / Nutrition screens, so both edit
// exactly the same fields. See docs/ai-plans-design.md §3.

type Patch = (patch: Partial<Preferences>) => void

// ─── Building blocks ──────────────────────────────────────────────────────────

function Label({ children, hint }: { children: string; hint?: string }) {
  return (
    <View className="mb-2">
      <Text className="text-text-muted text-caption">{children}</Text>
      {hint && <Text className="text-text-subtle text-caption mt-1">{hint}</Text>}
    </View>
  )
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="px-4 py-3 rounded-full border"
      style={{
        borderCurve: 'continuous', backgroundColor: selected ? colors.text : colors.surface,
        borderColor: selected ? colors.text : colors.border,
      }}
    >
      <Text className="text-footnote font-medium" style={{ color: selected ? colors.bg : colors['text-muted'] }}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

/** Pick one. Tapping the selected chip again clears the answer. */
function SingleChoice<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[]
  value: T | null
  onChange: (v: T | null) => void
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => (
        <Chip
          key={String(o.key)}
          label={o.label}
          selected={value === o.key}
          onPress={() => onChange(value === o.key ? null : o.key)}
        />
      ))}
    </View>
  )
}

/** Preset chips plus free-text extras, stored as one lowercase list.
 *  `noneLabel` adds a chip that clears the list. */
function MultiChoice({
  presets,
  values,
  onChange,
  noneLabel,
  addPlaceholder,
}: {
  presets: { key: string; label: string }[]
  values: string[]
  onChange: (v: string[]) => void
  noneLabel?: string
  addPlaceholder?: string
}) {
  const [draft, setDraft] = useState('')
  const presetKeys = new Set(presets.map((p) => p.key))
  const extras = values.filter((v) => !presetKeys.has(v))

  const toggle = (key: string) =>
    onChange(values.includes(key) ? values.filter((v) => v !== key) : [...values, key])

  const add = () => {
    const v = draft.trim().replace(/\s+/g, ' ').toLowerCase()
    if (v && !values.includes(v)) onChange([...values, v])
    setDraft('')
  }

  return (
    <View>
      <View className="flex-row flex-wrap gap-2">
        {presets.map((p) => (
          <Chip key={p.key} label={p.label} selected={values.includes(p.key)} onPress={() => toggle(p.key)} />
        ))}
        {noneLabel && (
          <Chip label={noneLabel} selected={values.length === 0} onPress={() => onChange([])} />
        )}
      </View>
      {addPlaceholder && (
        <>
          {extras.length > 0 && (
            <View className="flex-row flex-wrap gap-2 mt-2">
              {extras.map((v) => (
                <TouchableOpacity
                  key={v}
                  onPress={() => toggle(v)}
                  className="flex-row items-center px-3 py-2 rounded-full bg-text gap-2"
                  style={{ borderCurve: 'continuous' }}
                  hitSlop={6}
                >
                  <Text className="text-bg text-footnote font-medium">{v}</Text>
                  <X size={14} color={colors.bg} strokeWidth={2.5} />
                </TouchableOpacity>
              ))}
            </View>
          )}
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            onBlur={add}
            placeholder={addPlaceholder}
            placeholderTextColor={colors['text-subtle']}
            returnKeyType="done"
            maxLength={40}
            className="bg-surface-raised border border-border rounded-md px-4 py-3 text-text text-footnote mt-2" style={{ borderCurve: 'continuous' }}
          />
        </>
      )}
    </View>
  )
}

// ─── Training ─────────────────────────────────────────────────────────────────

const EQUIPMENT: { key: Equipment; label: string }[] = [
  { key: 'gym', label: 'Gym' },
  { key: 'home_weights', label: 'Home with weights' },
  { key: 'bodyweight', label: 'Bodyweight only' },
]

const EXPERIENCE: { key: Experience; label: string }[] = [
  { key: 'new', label: 'New (<6 months)' },
  { key: 'some', label: '6 months – 2 years' },
  { key: 'experienced', label: '2+ years' },
]

const SESSION: { key: number; label: string }[] = [
  { key: 30, label: '30 min' },
  { key: 45, label: '45 min' },
  { key: 60, label: '60 min' },
  { key: 90, label: '90 min' },
]

const DAYS: { key: number; label: string }[] = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ key: d, label: String(d) }))

// Each preset is the session cycle the backend stores (plan_builder.py
// clean_split); null leaves the split to Pit Crew.
const SPLITS: { key: string; label: string; split: string[] | null }[] = [
  { key: 'auto', label: 'Pit Crew picks', split: null },
  { key: 'full', label: 'Full body', split: ['Full body'] },
  { key: 'upper_lower', label: 'Upper / Lower', split: ['Upper', 'Lower'] },
  { key: 'ppl', label: 'Push / Pull / Legs', split: ['Push', 'Pull', 'Legs'] },
  { key: 'bro', label: 'One muscle a day', split: ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms'] },
]
const SPLIT_MAX = 7

const tidy = (split: string[]) => split.map((v) => v.trim().replace(/\s+/g, ' ')).filter(Boolean)

function presetFor(split: string[] | null): string | null {
  const s = split ?? []
  const hit = SPLITS.find((p) => (p.split ?? []).join('|').toLowerCase() === s.join('|').toLowerCase())
  return hit ? hit.key : null
}

/** Presets, or your own sessions in order. Custom labels save when a field
 *  loses focus, not on every keystroke. */
function SplitField({ value, onChange }: { value: string[] | null; onChange: (v: string[] | null) => void }) {
  const preset = presetFor(value)
  const [custom, setCustom] = useState(preset === null)
  const [draft, setDraft] = useState<string[]>(value ?? [])

  const saved = (value ?? []).join('|')
  // Follow the saved value, but keep a draft that already matches it so an
  // empty row just added doesn't vanish when a save comes back.
  useEffect(() => {
    setDraft((d) => (tidy(d).join('|') === saved ? d : (value ?? [])))
    if (presetFor(value) === null) setCustom(true)
  }, [saved])

  const commit = (next: string[]) => {
    const clean = tidy(next)
    if (clean.join('|') !== saved) onChange(clean.length ? clean : null)
  }

  return (
    <View>
      <View className="flex-row flex-wrap gap-2">
        {SPLITS.map((p) => (
          <Chip
            key={p.key}
            label={p.label}
            selected={!custom && preset === p.key}
            onPress={() => {
              setCustom(false)
              onChange(p.split)
            }}
          />
        ))}
        <Chip
          label="My own"
          selected={custom}
          onPress={() => {
            setCustom(true)
            if (!draft.length) setDraft([''])
          }}
        />
      </View>
      {custom && (
        <View className="gap-2 mt-3">
          {draft.map((v, i) => (
            <View key={i} className="flex-row items-center gap-2">
              <Text className="text-text-subtle text-caption w-12">Day {i + 1}</Text>
              <TextInput
                value={v}
                onChangeText={(t) => setDraft(draft.map((x, j) => (j === i ? t : x)))}
                onBlur={() => commit(draft)}
                onSubmitEditing={() => commit(draft)}
                placeholder={['Chest + Back', 'Arms + Shoulders', 'Legs'][i] ?? 'Session'}
                placeholderTextColor={colors['text-subtle']}
                returnKeyType="done"
                maxLength={40}
                className="flex-1 bg-surface-raised border border-border rounded-md px-4 py-3 text-text text-footnote"
                style={{ borderCurve: 'continuous' }}
              />
              <TouchableOpacity
                onPress={() => {
                  const next = draft.filter((_, j) => j !== i)
                  setDraft(next)
                  commit(next)
                }}
                hitSlop={13}
                accessibilityLabel={`Remove day ${i + 1}`}
              >
                <X size={18} color={colors['text-subtle']} />
              </TouchableOpacity>
            </View>
          ))}
          {draft.length < SPLIT_MAX && (
            <TouchableOpacity onPress={() => setDraft([...draft, ''])} className="flex-row items-center gap-2 min-h-11">
              <Plus size={16} color={colors['text-muted']} />
              <Text className="text-text-muted text-footnote font-medium">Add a session</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  )
}

const INJURIES = [
  { key: 'shoulder', label: 'Shoulder' },
  { key: 'knee', label: 'Knee' },
  { key: 'lower back', label: 'Lower back' },
  { key: 'wrist', label: 'Wrist' },
  { key: 'elbow', label: 'Elbow' },
  { key: 'hip', label: 'Hip' },
]

export function TrainingPrefsFields({ value, onChange }: { value: Preferences; onChange: Patch }) {
  return (
    <View className="gap-6">
      <View>
        <Label>Where you train</Label>
        <SingleChoice options={EQUIPMENT} value={value.equipment} onChange={(v) => onChange({ equipment: v })} />
      </View>
      <View>
        <Label>Lifting experience</Label>
        <SingleChoice options={EXPERIENCE} value={value.experience} onChange={(v) => onChange({ experience: v })} />
      </View>
      <View>
        <Label hint="The days you actually train. If you skip one most weeks, count the rest.">Days a week</Label>
        <SingleChoice options={DAYS} value={value.training_days} onChange={(v) => onChange({ training_days: v })} />
      </View>
      <View>
        <Label hint="Sessions in the order you rotate them. They repeat across your training days.">Your split</Label>
        <SplitField value={value.split} onChange={(v) => onChange({ split: v })} />
      </View>
      <View>
        <Label>Time per session</Label>
        <SingleChoice
          options={SESSION}
          value={value.session_minutes}
          onChange={(v) => onChange({ session_minutes: v })}
        />
      </View>
      <View>
        <Label hint="Exercises that load it are left out of your plan.">Anything that hurts?</Label>
        <MultiChoice
          presets={INJURIES}
          values={value.injuries}
          onChange={(v) => onChange({ injuries: v })}
          noneLabel="Nothing"
          addPlaceholder="Something else? Type and press done"
        />
      </View>
    </View>
  )
}

// ─── Food ─────────────────────────────────────────────────────────────────────

const DIET: { key: DietStyle; label: string }[] = [
  { key: 'anything', label: 'Anything' },
  { key: 'vegetarian', label: 'Vegetarian' },
  { key: 'vegan', label: 'Vegan' },
  { key: 'pescatarian', label: 'Pescatarian' },
  { key: 'halal', label: 'Halal' },
  { key: 'kosher', label: 'Kosher' },
]

const ALLERGIES = [
  { key: 'peanuts', label: 'Peanuts' },
  { key: 'tree nuts', label: 'Tree nuts' },
  { key: 'dairy', label: 'Dairy' },
  { key: 'gluten', label: 'Gluten' },
  { key: 'eggs', label: 'Eggs' },
  { key: 'fish', label: 'Fish' },
  { key: 'shellfish', label: 'Shellfish' },
  { key: 'soy', label: 'Soy' },
]

const COOKING: { key: Cooking; label: string }[] = [
  { key: 'minimal', label: 'Minimal (<15 min)' },
  { key: 'some', label: 'Some (~30 min)' },
  { key: 'loves', label: 'I like cooking' },
]

const HEALTH: { key: HealthFlag; label: string }[] = [
  { key: 'pregnant', label: 'Pregnant or breastfeeding' },
  { key: 'eating_disorder', label: 'Eating disorder, now or in the past' },
  { key: 'diabetes', label: 'Diabetes' },
  { key: 'kidney', label: 'Kidney disease' },
]

export function FoodPrefsFields({ value, onChange }: { value: Preferences; onChange: Patch }) {
  const flags = value.health_flags
  const toggleFlag = (f: HealthFlag) => {
    const cur = flags ?? []
    onChange({ health_flags: cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f] })
  }

  return (
    <View className="gap-6">
      <View>
        <Label>How you eat</Label>
        <SingleChoice options={DIET} value={value.diet_style} onChange={(v) => onChange({ diet_style: v })} />
      </View>
      <View>
        <Label hint="Never used in your meal plan.">Allergies</Label>
        <MultiChoice
          presets={ALLERGIES}
          values={value.allergies}
          onChange={(v) => onChange({ allergies: v })}
          noneLabel="None"
          addPlaceholder="Another allergy? Type and press done"
        />
      </View>
      <View>
        <Label hint="You can also tell the Pit later.">Foods you won't eat</Label>
        <MultiChoice
          presets={[]}
          values={value.dislikes}
          onChange={(v) => onChange({ dislikes: v })}
          addPlaceholder="e.g. mushrooms — type and press done"
        />
      </View>
      <View>
        <Label>Cooking</Label>
        <SingleChoice options={COOKING} value={value.cooking} onChange={(v) => onChange({ cooking: v })} />
      </View>
      <View>
        <Label hint="If one applies, the Pit plans your training but leaves food to a doctor or dietitian.">
          Do any of these apply?
        </Label>
        <View className="gap-2">
          {HEALTH.map((h) => (
            <Chip key={h.key} label={h.label} selected={!!flags?.includes(h.key)} onPress={() => toggleFlag(h.key)} />
          ))}
          <Chip
            label="None of these"
            selected={flags !== null && flags.length === 0}
            onPress={() => onChange({ health_flags: [] })}
          />
        </View>
        <Text className="text-text-subtle text-caption mt-3">
          The Pit gives general fitness guidance, not medical advice. If you have a medical condition, check with
          your doctor before changing how you eat or train.
        </Text>
      </View>
    </View>
  )
}
