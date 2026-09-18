import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react-native'
import { AvatarCanvas } from '../components/avatar/AvatarCanvas'
import { useMyAvatar, useSaveAvatar } from '../hooks/useMyAvatar'
import { appliedBody, PALETTE, toState, type AvatarConfig, type LookColors } from '../lib/avatar/config'
import { useRewards } from '../hooks/useRewards'
import { ALL_EMOTES, emoteName, FREE_EMOTES } from '../lib/avatar/emotes'
import {
  EXCLUSIVE_PALETTE,
  extrasFor,
  ITEMS,
  itemName,
  type EquipSlot,
  type Equipped,
} from '../lib/avatar/rewards'

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
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <View className="flex-row items-center px-4 pt-2 pb-2">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="-ml-1 pr-4 py-2 flex-row items-center" style={{ gap: 2 }}>
          <ChevronLeft size={22} color="#d4d4d8" strokeWidth={2.25} />
          <Text className="text-zinc-300 text-base font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold flex-1">Your avatar</Text>
        <TouchableOpacity
          onPress={() => save.mutate(buildConfig(false))}
          disabled={!dirty || save.isPending}
          className="px-4 py-2 rounded-xl"
          style={{ backgroundColor: dirty ? '#ffffff' : '#27272a' }}
        >
          {save.isPending ? (
            <ActivityIndicator color="#000" size="small" />
          ) : (
            <Text className="text-sm font-semibold" style={{ color: dirty ? '#000' : '#71717a' }}>
              {savedFlash ? 'Saved' : 'Save'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={{ height: 360 }} className="mx-4 rounded-3xl bg-zinc-900 overflow-hidden">
        <AvatarCanvas base={base} state={state} emote={equipped.emote ?? null} style={{ flex: 1 }} />
        <Text pointerEvents="none" className="absolute bottom-3 self-center text-zinc-600 text-[11px]">
          Drag to turn
        </Text>
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingTop: 16, paddingBottom: 48, gap: 20 }}>
        {body.levelUpAvailable && (
          <View className="rounded-2xl p-4 border" style={{ backgroundColor: '#052e16', borderColor: '#166534' }}>
            <Text className="text-green-300 text-base font-bold">Your avatar leveled up ↑</Text>
            <Text className="text-green-100/70 text-xs mt-1">
              Your latest body metrics changed your shape. Preview it, then apply it if you like it.
            </Text>
            <View className="flex-row mt-3" style={{ gap: 8 }}>
              <TouchableOpacity onPress={playLevelUp} className="flex-1 py-2.5 rounded-xl items-center border border-green-700">
                <Text className="text-green-200 text-sm font-semibold">{morph == null ? 'Preview' : 'Replay'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={applyLevelUp}
                disabled={save.isPending}
                className="flex-1 py-2.5 rounded-xl items-center bg-green-500"
              >
                <Text className="text-black text-sm font-bold">Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {SECTIONS.map((section) => (
          <View key={section.key}>
            <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-2">{section.label}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {[...PALETTE[section.key], ...exclusiveFor(section.key, owned)].map((color) => {
                const selected = look[section.key] === color
                return (
                  <TouchableOpacity
                    key={color}
                    onPress={() => setLook((l) => ({ ...l, [section.key]: color }))}
                    accessibilityLabel={`${section.label} ${color}`}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      backgroundColor: color,
                      borderWidth: selected ? 3 : 1,
                      borderColor: selected ? '#ffffff' : '#3f3f46',
                    }}
                  />
                )
              })}
            </ScrollView>
          </View>
        ))}

        <View className="bg-zinc-900 rounded-2xl">
          <ToggleRow
            label="Freeze body shape"
            detail="Keep your avatar's body as it is, even when your weight or body fat changes."
            value={frozen}
            onChange={setFrozen}
          />
          <View className="h-px bg-zinc-800 mx-4" />
          <ToggleRow
            label="Show my body shape to friends"
            detail="Off: friends see your colors on a neutral body. They never see your weight or body fat either way."
            value={shareBody}
            onChange={setShareBody}
          />
        </View>

        <View>
          <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-2">Unlockables</Text>
          <View className="bg-zinc-900 rounded-2xl p-4" style={{ gap: 14 }}>
            {SLOTS.map((slot) => {
              const mine = owned.filter((id) => ITEMS[id]?.slot === slot.key)
              const locked = Object.keys(ITEMS).filter(
                (id) => ITEMS[id].slot === slot.key && !id.endsWith('_gold') && !owned.includes(id),
              )
              return (
                <View key={slot.key}>
                  <Text className="text-zinc-300 text-sm font-medium mb-2">{slot.label}</Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
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
          <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-2">Podium emote</Text>
          <View className="bg-zinc-900 rounded-2xl p-4">
            <Text className="text-zinc-500 text-xs mb-3">
              What you do when you place top 3 in the weekly race. Tap one to preview it above.
            </Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              <Chip
                label="Random free"
                selected={!equipped.emote}
                onPress={() => setEquipped((e) => ({ ...e, emote: null }))}
              />
              {ALL_EMOTES.filter((id) => FREE_EMOTES.includes(id) || owned.includes(id)).map((id) => (
                <Chip
                  key={id}
                  label={emoteName(id)}
                  selected={equipped.emote === id}
                  onPress={() => setEquipped((e) => ({ ...e, emote: id }))}
                />
              ))}
              {ALL_EMOTES.filter((id) => !FREE_EMOTES.includes(id) && !owned.includes(id)).map((id) => (
                <Chip key={id} label={emoteName(id)} locked onPress={() => router.push('/combo-dex')} />
              ))}
            </View>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => router.push('/combo-dex')}
          className="bg-zinc-900 rounded-2xl p-4 flex-row items-center"
          style={{ gap: 12 }}
        >
          <View className="flex-1">
            <Text className="text-white text-sm font-medium">Combo Dex</Text>
            <Text className="text-zinc-500 text-xs mt-0.5">
              Every combo and milestone, your progress, and what's still secret.
            </Text>
          </View>
          <ChevronRight size={18} color="#71717a" />
        </TouchableOpacity>

        {save.isError && (
          <Text className="text-red-400 text-xs text-center">Couldn't save your avatar. Check your connection and try again.</Text>
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
    <View className="flex-row items-center px-4 py-3.5" style={{ gap: 12 }}>
      <View className="flex-1">
        <Text className="text-white text-sm font-medium">{label}</Text>
        <Text className="text-zinc-500 text-xs mt-0.5">{detail}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: '#22c55e' }} />
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
      className="flex-row items-center px-3 py-2 rounded-xl border"
      style={{
        gap: 6,
        backgroundColor: selected ? '#ffffff' : '#18181b',
        borderColor: selected ? '#ffffff' : '#3f3f46',
        opacity: locked ? 0.5 : 1,
      }}
    >
      {locked ? (
        <Lock size={12} color="#a1a1aa" />
      ) : color ? (
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      ) : null}
      <Text className="text-xs font-semibold" style={{ color: selected ? '#000' : '#d4d4d8' }}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}
