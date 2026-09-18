import { useState } from 'react'
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { hapticSuccess } from '../../lib/haptics'
import { useMyAvatar, useSaveAvatar } from '../../hooks/useMyAvatar'
import { useMarkRewardsSeen } from '../../hooks/useRewards'
import { ITEMS, itemName, RARITY_COLOR, type RewardNew } from '../../lib/avatar/rewards'
import { emoteName } from '../../lib/avatar/emotes'

/** Celebrates newly earned combos/milestones, with one-tap equip. */
export function UnlockModal({ items }: { items: RewardNew[] }) {
  const markSeen = useMarkRewardsSeen()
  const { config } = useMyAvatar()
  const save = useSaveAvatar()
  const [equipped, setEquipped] = useState<string[]>([])
  // Marking seen clears `items` in the query cache, which hides the modal.
  const visible = items.length > 0 && !markSeen.isPending

  function close(then?: () => void) {
    markSeen.mutate(undefined, { onSettled: () => then?.() })
  }

  function equip(item: string, emote = false) {
    const slot = emote ? 'emote' : ITEMS[item]?.slot
    if (!slot) return
    save.mutate(
      { ...config, equipped: { ...(config.equipped ?? {}), [slot]: item } },
      {
        onSuccess: () => {
          hapticSuccess()
          setEquipped((e) => [...e, item])
        },
      },
    )
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onShow={hapticSuccess} onRequestClose={() => close()}>
      <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}>
        <View className="w-full rounded-3xl bg-zinc-950 border border-zinc-800 p-5" style={{ maxHeight: '80%' }}>
          <Text className="text-zinc-500 text-[10px] uppercase tracking-[3px] text-center">Avatar unlock</Text>
          <Text className="text-white text-2xl font-bold text-center mt-1">
            {items.length === 1 ? 'You unlocked something' : `You unlocked ${items.length} things`}
          </Text>

          <ScrollView className="mt-4" contentContainerStyle={{ gap: 10 }}>
            {items.map((n) => {
              const color = n.golden ? RARITY_COLOR.legendary : RARITY_COLOR[n.rarity]
              const canEquip = !!n.reward && !!ITEMS[n.reward]?.slot
              const isEquipped = !!n.reward && equipped.includes(n.reward)
              return (
                <View key={n.key + (n.golden ? ':gold' : '')} className="rounded-2xl p-3.5 border" style={{ borderColor: color, backgroundColor: '#18181b' }}>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-white text-base font-bold flex-1">
                      {n.golden ? '✨ Golden ' : ''}
                      {n.name}
                    </Text>
                    <Text className="text-[10px] font-bold uppercase" style={{ color }}>
                      {n.golden ? 'golden' : n.rarity}
                    </Text>
                  </View>
                  <Text className="text-zinc-400 text-xs mt-1">
                    Reward: <Text className="text-zinc-200">{itemName(n.reward)}</Text>
                    {!n.has_art ? '  ·  3D art coming soon — it’s saved to your account' : ''}
                  </Text>
                  {n.emotes?.map((e) => {
                    const on = equipped.includes(e)
                    return (
                      <View key={e} className="flex-row items-center justify-between mt-2">
                        <Text className="text-zinc-300 text-xs">
                          + Emote: <Text className="text-white font-semibold">{emoteName(e)}</Text>
                        </Text>
                        <TouchableOpacity
                          onPress={() => equip(e, true)}
                          disabled={on || save.isPending}
                          className="px-3 py-1.5 rounded-lg"
                          style={{ backgroundColor: on ? '#27272a' : color }}
                        >
                          <Text className="text-xs font-semibold" style={{ color: on ? '#a1a1aa' : '#000' }}>
                            {on ? 'Equipped' : 'Use on podium'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )
                  })}
                  {canEquip && (
                    <TouchableOpacity
                      onPress={() => equip(n.reward!)}
                      disabled={isEquipped || save.isPending}
                      className="mt-3 py-2 rounded-xl items-center"
                      style={{ backgroundColor: isEquipped ? '#27272a' : color }}
                    >
                      <Text className="text-sm font-semibold" style={{ color: isEquipped ? '#a1a1aa' : '#000' }}>
                        {isEquipped ? 'Equipped' : 'Equip'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )
            })}
          </ScrollView>

          <View className="flex-row mt-4" style={{ gap: 8 }}>
            <TouchableOpacity
              onPress={() => close(() => router.push('/combo-dex'))}
              className="flex-1 py-3 rounded-xl items-center border border-zinc-700"
            >
              <Text className="text-zinc-200 text-sm font-semibold">Combo Dex</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => close()} className="flex-1 py-3 rounded-xl items-center bg-white">
              <Text className="text-black text-sm font-bold">Nice</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
