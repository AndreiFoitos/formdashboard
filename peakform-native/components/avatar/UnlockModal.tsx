import { useState } from 'react'
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { hapticSuccess } from '../../lib/haptics'
import { useMyAvatar, useSaveAvatar } from '../../hooks/useMyAvatar'
import { useMarkRewardsSeen } from '../../hooks/useRewards'
import { ITEMS, itemName, RARITY_COLOR, type RewardNew } from '../../lib/avatar/rewards'
import { emoteName } from '../../lib/avatar/emotes'
import { colors } from '../../theme/tokens'

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
      <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: `${colors.bg}bf` }}>
        <View className="w-full rounded-xl bg-surface border border-divider p-5" style={{ borderCurve: 'continuous', maxHeight: '80%' }}>
          <Text className="text-text-subtle text-caption text-center">Avatar unlock</Text>
          <Text className="text-text text-title font-bold text-center mt-1">
            {items.length === 1 ? 'You unlocked something' : `You unlocked ${items.length} things`}
          </Text>

          <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} className="mt-4" contentContainerClassName="gap-3">
            {items.map((n) => {
              const color = n.golden ? RARITY_COLOR.legendary : RARITY_COLOR[n.rarity]
              const canEquip = !!n.reward && !!ITEMS[n.reward]?.slot
              const isEquipped = !!n.reward && equipped.includes(n.reward)
              return (
                <View key={n.key + (n.golden ? ':gold' : '')} className="rounded-xl p-4 border" style={{ borderCurve: 'continuous', borderColor: color, backgroundColor: colors['surface-raised'] }}>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-text text-body font-bold flex-1">
                      {n.golden ? '✨ Golden ' : ''}
                      {n.name}
                    </Text>
                    <Text className="text-caption font-bold" style={{ color }}>
                      {n.golden ? 'Golden' : n.rarity.charAt(0).toUpperCase() + n.rarity.slice(1)}
                    </Text>
                  </View>
                  <Text className="text-text-muted text-caption mt-1">
                    Reward: <Text className="text-text">{itemName(n.reward)}</Text>
                    {!n.has_art ? '  ·  Badge, saved to your Combo Dex' : ''}
                  </Text>
                  {n.emotes?.map((e) => {
                    const on = equipped.includes(e)
                    return (
                      <View key={e} className="flex-row items-center justify-between mt-2">
                        <Text className="text-text-muted text-caption">
                          + Emote: <Text className="text-text font-semibold">{emoteName(e)}</Text>
                        </Text>
                        <TouchableOpacity
                          onPress={() => equip(e, true)}
                          disabled={on || save.isPending}
                          className="px-3 py-2 rounded-md"
                          style={{ borderCurve: 'continuous', backgroundColor: on ? colors.border : color }}
                        >
                          <Text className="text-caption font-semibold" style={{ color: on ? colors['text-muted'] : colors.bg }}>
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
                      className="mt-3 py-2 rounded-md items-center"
                      style={{ borderCurve: 'continuous', backgroundColor: isEquipped ? colors.border : color }}
                    >
                      <Text className="text-footnote font-semibold" style={{ color: isEquipped ? colors['text-muted'] : colors.bg }}>
                        {isEquipped ? 'Equipped' : 'Equip'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )
            })}
          </ScrollView>

          <View className="flex-row mt-4 gap-2">
            <TouchableOpacity
              onPress={() => close(() => router.push('/combo-dex'))}
              className="flex-1 py-3 rounded-md items-center border border-border" style={{ borderCurve: 'continuous' }}
            >
              <Text className="text-text text-footnote font-semibold">Combo Dex</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => close()} className="flex-1 py-3 rounded-md items-center bg-accent" style={{ borderCurve: 'continuous' }}>
              <Text className="text-on-accent text-footnote font-bold">Nice</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
