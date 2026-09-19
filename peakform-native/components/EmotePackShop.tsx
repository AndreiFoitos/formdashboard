import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import type { PurchasesStoreProduct } from 'react-native-purchases'
import { PressableScale } from './PressableScale'
import { emoteName } from '../lib/avatar/emotes'
import { buyProduct, loadPackProducts, purchasesEnabled } from '../lib/purchases'
import { extractErrorMessage } from '../lib/apiError'
import { hapticSuccess } from '../lib/haptics'
import { openPaywall, usePlan, useSetPlan, type PackInfo } from '../hooks/usePlan'
import { REWARDS_KEY } from '../hooks/useRewards'

/**
 * Paid emote packs (backend/services/avatar_packs.py). A pack is listed only
 * once its App Store product exists (price loaded) or the user owns it, so a
 * pack whose clips aren't in this build yet never shows up for sale.
 */
export function EmotePackShop({ onPreview }: { onPreview: (emote: string) => void }) {
  const { data: plan } = usePlan()
  const setPlan = useSetPlan()
  const qc = useQueryClient()
  const [products, setProducts] = useState<Record<string, PurchasesStoreProduct>>({})
  const [buying, setBuying] = useState<string | null>(null)

  const packs = plan?.packs ?? []
  const productKey = packs.map((p) => p.product_id).join(',')

  useEffect(() => {
    if (!productKey) return
    loadPackProducts(productKey.split(',')).then(setProducts).catch(() => {})
  }, [productKey])

  const visible = packs.filter((p) => p.owned || products[p.product_id])
  if (!purchasesEnabled || visible.length === 0) return null

  async function buy(pack: PackInfo) {
    const product = products[pack.product_id]
    if (!product || buying) return
    setBuying(pack.id)
    try {
      const updated = await buyProduct(product)
      if (!updated) return
      setPlan(updated)
      qc.invalidateQueries({ queryKey: REWARDS_KEY })
      hapticSuccess()
      Alert.alert(`${pack.name} unlocked!`, 'Pick one of its emotes under Podium emote.')
    } catch (e) {
      Alert.alert('Purchase failed', extractErrorMessage(e, 'Nothing was charged. Try again in a moment.'))
    } finally {
      setBuying(null)
    }
  }

  return (
    <View>
      <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-2">Emote packs</Text>
      <View style={{ gap: 10 }}>
        {visible.map((pack) => {
          const product = products[pack.product_id]
          const emotes = pack.items.emote ?? []
          return (
            <View key={pack.id} className="bg-zinc-900 rounded-2xl p-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-white text-base font-semibold">{pack.name}</Text>
                {pack.owned ? (
                  <Text className="text-green-400 text-sm font-medium">Owned</Text>
                ) : (
                  <PressableScale
                    haptic
                    onPress={() => buy(pack)}
                    disabled={!!buying}
                    className="rounded-xl px-4 py-2"
                    style={{ backgroundColor: '#facc15' }}
                  >
                    {buying === pack.id ? (
                      <ActivityIndicator color="#000" size="small" />
                    ) : (
                      <Text className="text-black text-sm font-bold">{product?.priceString ?? '—'}</Text>
                    )}
                  </PressableScale>
                )}
              </View>
              <Text className="text-zinc-500 text-xs mt-1 mb-3">Tap an emote to preview it. Yours forever.</Text>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {emotes.map((id) => (
                  <TouchableOpacity
                    key={id}
                    onPress={() => onPreview(id)}
                    className="px-3 py-2 rounded-xl border border-zinc-700 bg-zinc-950"
                  >
                    <Text className="text-zinc-200 text-sm">{emoteName(id)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )
        })}
      </View>
      {plan && plan.plan !== 'pro' && (
        <TouchableOpacity onPress={() => openPaywall()} className="mt-2">
          <Text className="text-zinc-500 text-xs">Pro members get emote packs at a discount ›</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}
