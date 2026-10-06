import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react-native'
import { AvatarCanvas } from '../components/avatar/AvatarCanvas'
import { useMyAvatar, useSaveAvatar } from '../hooks/useMyAvatar'
import { appliedBody, PALETTE, toState, type AvatarConfig, type LookColors } from '../lib/avatar/config'
import { useRewards } from '../hooks/useRewards'
import { ALL_EMOTES, emoteName, FREE_EMOTES, PACK_EMOTE_NAMES } from '../lib/avatar/emotes'
import { EmotePackShop } from '../components/EmotePackShop'
import {
  EXCLUSIVE_PALETTE,
  extrasFor,
  ITEMS,
  itemName,
  type EquipSlot,
  type Equipped,
} from '../lib/avatar/rewards'
import { colors } from '../theme/tokens'

const SLOTS: { key: EquipSlot; label: string }[] = [
  { key: 'aura', label: 'Aura' },
  { key: 'frame', label: 'Badge frame' },
  { key: 'eyes', label: 'Eyes' },
]

const SECTIONS: { key: keyof LookColors; label: string }[] = [
  { key: 'skin', label: 'Skin' },
  { key: 'hair', label: 'Hair' },
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'shoes', label: 'Shoes' },
]

const LEVEL_UP_MS = 1600

export default function AvatarEditScreen() {
  const { base, config, current, body, hasSaved } = useMyAvatar()
  const [look, setLook] = useState<LookColors>(config.look)
  const [frozen, setFrozen] = useState(!!config.frozen)
  const [shareBody, setShareBody] = useState(config.share_body ?? true)
  const [equipped, setEquipped] = useState<Equipped>(config.equipped ?? {})
  // A pack emote being previewed from the shop; not saved, cleared on any pick.
  const [previewEmote, setPreviewEmote] = useState<string | null>(null)
  const rewards = useRewards()
  const owned = rewards.data?.owned ?? []
  const [savedFlash, setSavedFlash] = useState(false)
  const save = useSaveAvatar(() => {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1800)
  })

  // Level-up morph: 0 = applied body, 1 = body from current metrics.
  const [morph, setMorph] = useState<number | null>(null)
  const raf = useRef<number | null>(null)
  useEffect(() => () => {
    if (raf.current != null) cancelAnimationFrame(raf.current)
  }, [])

  function playLevelUp() {
    const start = Date.now()
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / LEVEL_UP_MS)
      setMorph(t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
      if (t < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }

  const shownBody = useMemo(() => {
    if (morph == null) return body
    const lerp = (a: number, b: number) => a + (b - a) * morph
    return {
      ...body,
      fat: lerp(body.fat, current.fat),
      muscle: lerp(body.muscle, current.muscle),
      heightScale: lerp(body.heightScale, current.heightScale),
    }
  }, [morph, body, current])

  const extras = useMemo(() => extrasFor([], equipped), [equipped])
  const state = useMemo(() => toState(look, shownBody, undefined, extras), [look, shownBody, extras])

  const dirty =
    !hasSaved ||
    SECTIONS.some((s) => look[s.key] !== config.look[s.key]) ||
    frozen !== !!config.frozen ||
    shareBody !== (config.share_body ?? true) ||
    SLOTS.some((sl) => (equipped[sl.key] ?? null) !== (config.equipped?.[sl.key] ?? null)) ||
    (equipped.emote ?? null) !== (config.equipped?.emote ?? null)

  function buildConfig(applyCurrentBody: boolean): AvatarConfig {
    return {
      v: 1,
      look,
      body: applyCurrentBody || !config.body ? appliedBody(current) : config.body,
      frozen,
      share_body: shareBody,
      equipped,
    }
  }

  function applyLevelUp() {
    save.mutate(buildConfig(true), { onSuccess: () => setMorph(null) })
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-4 pt-2 pb-2">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="-ml-1 pr-4 py-2 flex-row items-center gap-1">
          <ChevronLeft size={22} color={colors.text} strokeWidth={2.25} />
          <Text className="text-text-muted text-body font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-text text-headline font-bold flex-1">Your avatar</Text>
        <TouchableOpacity
          onPress={() => save.mutate(buildConfig(false))}
          disabled={!dirty || save.isPending}
          className="px-4 py-2 rounded-md"
          style={{ borderCurve: 'continuous', backgroundColor: dirty ? colors.accent : colors['surface-raised'] }}
        >
          {save.isPending ? (
            <ActivityIndicator color={colors['on-accent']} size="small" />
          ) : (
            <Text className="text-footnote font-semibold" style={{ color: dirty ? colors['on-accent'] : colors['text-subtle'] }}>
              {savedFlash ? 'Saved' : 'Save'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={{ borderCurve: 'continuous', height: 360 }} className="mx-4 rounded-xl bg-surface overflow-hidden">
        <AvatarCanvas base={base} state={state} emote={previewEmote ?? equipped.emote ?? null} style={{ flex: 1 }} />
        <Text pointerEvents="none" className="absolute bottom-3 self-center text-text-subtle text-caption">
          Drag to turn
        </Text>
      </View>

      <ScrollView className="flex-1 px-4" contentContainerClassName="pt-4 pb-12 gap-5">
        {body.levelUpAvailable && (
          <View className="rounded-xl p-4 border bg-success/15 border-success/40" style={{ borderCurve: 'continuous' }}>
            <Text className="text-success text-body font-bold">Your avatar leveled up ↑</Text>
            <Text className="text-text-muted text-caption mt-1">
              Your latest body metrics changed your shape. Preview it, then apply it if you like it.
            </Text>
            <View className="flex-row mt-3 gap-2">
              <TouchableOpacity onPress={playLevelUp} className="flex-1 py-3 rounded-md items-center border border-success/40" style={{ borderCurve: 'continuous' }}>
                <Text className="text-success text-footnote font-semibold">{morph == null ? 'Preview' : 'Replay'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={applyLevelUp}
                disabled={save.isPending}
                className="flex-1 py-3 rounded-md items-center bg-success" style={{ borderCurve: 'continuous' }}
              >
                <Text className="text-bg text-footnote font-bold">Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {SECTIONS.map((section) => (
          <View key={section.key}>
            <Text className="text-text-muted text-caption mb-2">{section.label}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3">
              {[...PALETTE[section.key], ...exclusiveFor(section.key, owned)].map((color) => {
                const selected = look[section.key] === color
                return (
                  <TouchableOpacity
                    key={color}
                    onPress={() => setLook((l) => ({ ...l, [section.key]: color }))}
                    accessibilityLabel={`${section.label} ${color}`}
                    className="rounded-full"
                    style={{
                      borderCurve: 'continuous',
                      width: 38,
                      height: 38,
                      backgroundColor: color,
                      borderWidth: selected ? 3 : 1,
                      borderColor: selected ? colors.text : colors.border,
                    }}
                  />
                )
              })}
            </ScrollView>
          </View>
        ))}

        <View className="bg-surface rounded-xl" style={{ borderCurve: 'continuous' }}>
          <ToggleRow
            label="Freeze body shape"
            detail="Keep your avatar's body as it is, even when your weight or body fat changes."
            value={frozen}
            onChange={setFrozen}
          />
          <View className="h-px bg-surface-raised mx-4" />
          <ToggleRow
            label="Show my body shape to friends"
            detail="Off: friends see your colors on a neutral body. They never see your weight or body fat either way."
            value={shareBody}
            onChange={setShareBody}
          />
        </View>

        <View>
          <Text className="text-text-muted text-caption mb-2">Unlockables</Text>
          <View className="bg-surface rounded-xl p-4 gap-4" style={{ borderCurve: 'continuous' }}>
            {SLOTS.map((slot) => {
              const mine = owned.filter((id) => ITEMS[id]?.slot === slot.key)
              const locked = Object.keys(ITEMS).filter(
                (id) => ITEMS[id].slot === slot.key && !id.endsWith('_gold') && !owned.includes(id),
              )
              return (
                <View key={slot.key}>
                  <Text className="text-text-muted text-footnote font-medium mb-2">{slot.label}</Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Chip label="None" selected={!equipped[slot.key]} onPress={() => setEquipped((e) => ({ ...e, [slot.key]: null }))} />
                    {mine.map((id) => (
                      <Chip
                        key={id}
                        label={itemName(id)}
                        color={ITEMS[id].color}
                        selected={equipped[slot.key] === id}
                        onPress={() => setEquipped((e) => ({ ...e, [slot.key]: id }))}
                      />
                    ))}
                    {locked.map((id) => (
                      <Chip key={id} label={itemName(id)} locked onPress={() => router.push('/combo-dex')} />
                    ))}
                  </View>
                </View>
              )
            })}
          </View>
        </View>

        <View>
          <Text className="text-text-muted text-caption mb-2">Podium emote</Text>
          <View className="bg-surface rounded-xl p-4" style={{ borderCurve: 'continuous' }}>
            <Text className="text-text-subtle text-caption mb-3">
              What you do when you place top 3 in the weekly race. Tap one to preview it above.
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip
                label="Random free"
                selected={!equipped.emote && !previewEmote}
                onPress={() => {
                  setPreviewEmote(null)
                  setEquipped((e) => ({ ...e, emote: null }))
                }}
              />
              {[
                ...ALL_EMOTES.filter((id) => FREE_EMOTES.includes(id) || owned.includes(id)),
                ...Object.keys(PACK_EMOTE_NAMES).filter((id) => owned.includes(id)),
              ].map((id) => (
                <Chip
                  key={id}
                  label={emoteName(id)}
                  selected={!previewEmote && equipped.emote === id}
                  onPress={() => {
                    setPreviewEmote(null)
                    setEquipped((e) => ({ ...e, emote: id }))
                  }}
                />
              ))}
              {ALL_EMOTES.filter((id) => !FREE_EMOTES.includes(id) && !owned.includes(id)).map((id) => (
                <Chip key={id} label={emoteName(id)} locked onPress={() => router.push('/combo-dex')} />
              ))}
            </View>
          </View>
        </View>

        <EmotePackShop onPreview={setPreviewEmote} />

        <TouchableOpacity
          onPress={() => router.push('/combo-dex')}
          className="bg-surface rounded-xl p-4 flex-row items-center gap-3" style={{ borderCurve: 'continuous' }}
        >
          <View className="flex-1">
            <Text className="text-text text-footnote font-medium">Combo Dex</Text>
            <Text className="text-text-subtle text-caption mt-1">
              Every combo and milestone, your progress, and what's still secret.
            </Text>
          </View>
          <ChevronRight size={18} color={colors['text-subtle']} />
        </TouchableOpacity>

        {save.isError && (
          <Text className="text-danger text-caption text-center">Couldn't save your avatar. Check your connection and try again.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function ToggleRow({
  label,
  detail,
  value,
  onChange,
}: {
  label: string
  detail: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <View className="flex-row items-center px-4 py-4 gap-3">
      <View className="flex-1">
        <Text className="text-text text-footnote font-medium">{label}</Text>
        <Text className="text-text-subtle text-caption mt-1">{detail}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.success }} />
    </View>
  )
}

/** Exclusive outfit colors the user owns (aqua/gold colorways). */
function exclusiveFor(slot: keyof LookColors, owned: string[]): string[] {
  if (slot !== 'top' && slot !== 'bottom' && slot !== 'shoes') return []
  return EXCLUSIVE_PALETTE.filter((c) => owned.includes(c.colorway)).map((c) => c[slot])
}

function Chip({
  label,
  selected,
  locked,
  color,
  onPress,
}: {
  label: string
  selected?: boolean
  locked?: boolean
  color?: string
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center px-3 py-2 rounded-full border gap-2"
      style={{
        borderCurve: 'continuous',
        backgroundColor: selected ? colors.text : colors.surface,
        borderColor: selected ? colors.text : colors.border,
        opacity: locked ? 0.5 : 1,
      }}
    >
      {locked ? (
        <Lock size={12} color={colors['text-muted']} />
      ) : color ? (
        <View className="rounded-full" style={{ borderCurve: 'continuous', width: 10, height: 10, backgroundColor: color }} />
      ) : null}
      <Text className="text-caption font-semibold" style={{ color: selected ? colors.bg : colors['text-muted'] }}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}
