import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { Check, X } from 'lucide-react-native'
import type { PurchasesPackage } from 'react-native-purchases'
import { PressableScale } from '../components/PressableScale'
import { hapticSuccess } from '../lib/haptics'
import { extractErrorMessage } from '../lib/apiError'
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../lib/legal'
import {
  SUBSCRIPTION_PRODUCTS,
  buyPackage,
  loadSubscriptionPackages,
  manageSubscription,
  purchasesEnabled,
  restorePurchases,
  trialEligible,
} from '../lib/purchases'
import { PLAN_NAMES, usePlan, useSetPlan, type PaywallReason } from '../hooks/usePlan'

type Tier = 'plus' | 'pro'
type Period = 'monthly' | 'yearly'

// Mirrors backend/services/plans.py. Pro's food cap is fair use, stated in the footnote.
const FEATURES: Record<Tier, string[]> = {
  plus: [
    '4 food scans a day',
    '3 body-fat scans a week',
    '15 AI questions a day',
    '90 days of trends',
    'Up to 50 friends',
  ],
  pro: [
    'Unlimited food scans*',
    'A body-fat scan every day',
    '50 AI questions a day',
    'A full year of trends',
    'Export your data',
    'Up to 150 friends',
    'Emote packs at a discount',
  ],
}
const FREE_LINE =
  'Free: 1 food scan a day, 1 body-fat scan a week, 3 questions a day, 30 days of trends, 15 friends.'

const HEADLINES: Record<PaywallReason | 'default', { title: string; sub: string }> = {
  food: { title: "You've used today's food scan", sub: 'Upgrade to keep snapping meals.' },
  bf: { title: "You've used this week's body-fat scan", sub: 'Upgrade to track your progress more often.' },
  ask: { title: "You've used today's questions", sub: 'Upgrade to keep asking about your data.' },
  history: { title: 'See further back', sub: 'Plus shows 90 days of trends, Pro a full year.' },
  export: { title: 'Export your data', sub: 'Pro members can download everything they logged.' },
  friends: { title: 'Your friends list is full', sub: 'Upgrade to race with more friends.' },
  default: { title: 'Level up your race', sub: 'More scans, more friends, more flex.' },
}

function trialLabel(pkg?: PurchasesPackage): string | null {
  const intro = pkg?.product.introPrice
  if (!intro || intro.price !== 0) return null
  const unit = intro.periodUnit.toLowerCase().replace(/s$/, '')
  return `${intro.periodNumberOfUnits}-${unit} free trial`
}

export default function PaywallScreen() {
  const { reason } = useLocalSearchParams<{ reason?: PaywallReason }>()
  const head = HEADLINES[reason ?? 'default'] ?? HEADLINES.default
  const { data: plan } = usePlan()
  const setPlan = useSetPlan()

  const [packages, setPackages] = useState<Record<string, PurchasesPackage> | null>(null)
  const [eligible, setEligible] = useState<Set<string>>(new Set())
  const [loadError, setLoadError] = useState<string | null>(null)
  // Kept so the message can reveal the store's own words when tapped.
  const [loadErrorDetail, setLoadErrorDetail] = useState<string | null>(null)
  const [tier, setTier] = useState<Tier>('pro')
  const [period, setPeriod] = useState<Period>('yearly')
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null)

  useEffect(() => {
    if (!purchasesEnabled) return
    ;(async () => {
      try {
        const pkgs = await loadSubscriptionPackages()
        setPackages(pkgs)
        setEligible(await trialEligible(Object.keys(pkgs)).catch(() => new Set<string>()))
      } catch (e) {
        // RevenueCat's own message is developer-facing (config / "offerings empty").
        console.warn('Paywall: loading packages failed', e)
        setLoadError("Couldn't load prices from the App Store. Check your connection and try again later.")
        setLoadErrorDetail(extractErrorMessage(e, 'No details'))
      }
    })()
  }, [])

  const pkg = packages?.[SUBSCRIPTION_PRODUCTS[tier][period]]
  const monthlyOf = (t: Tier) => packages?.[SUBSCRIPTION_PRODUCTS[t].monthly]
  const yearlyOf = (t: Tier) => packages?.[SUBSCRIPTION_PRODUCTS[t].yearly]

  // "Save 41%" on the yearly toggle, from real store prices.
  const yearlySaving = useMemo(() => {
    const m = monthlyOf('pro')?.product.price
    const y = yearlyOf('pro')?.product.price
    if (!m || !y) return null
    const pct = Math.round((1 - y / (m * 12)) * 100)
    return pct > 0 ? pct : null
  }, [packages])

  const trial = pkg && eligible.has(pkg.product.identifier) ? trialLabel(pkg) : null
  const perPeriod = period === 'yearly' ? 'year' : 'month'
  const current = plan?.plan ?? 'free'
  const isCurrent = current === tier

  async function buy() {
    if (!pkg || busy) return
    setBusy('buy')
    try {
      const updated = await buyPackage(pkg)
      if (!updated) return // cancelled in Apple's sheet
      setPlan(updated)
      hapticSuccess()
      Alert.alert(`Welcome to ${PLAN_NAMES[updated.plan]}!`, 'Your new limits are active now.', [
        { text: 'Nice', onPress: () => router.back() },
      ])
    } catch (e) {
      Alert.alert('Purchase failed', extractErrorMessage(e, 'Nothing was charged. Try again in a moment.'))
    } finally {
      setBusy(null)
    }
  }

  async function restore() {
    if (busy) return
    setBusy('restore')
    try {
      const updated = await restorePurchases()
      setPlan(updated)
      Alert.alert(
        'Purchases restored',
        updated.plan === 'free' ? 'No active subscription was found for this Apple ID.' : `You're on ${PLAN_NAMES[updated.plan]}.`,
      )
    } catch (e) {
      Alert.alert("Couldn't restore", extractErrorMessage(e, 'Try again in a moment.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
      <View className="flex-row px-4 pt-2">
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={12}
          className="w-10 h-10 rounded-full bg-zinc-900 items-center justify-center"
          accessibilityLabel="Close"
        >
          <X size={20} color="#d4d4d8" strokeWidth={2.25} />
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 24 }}>
        <Text className="text-white text-3xl font-bold mt-4">{head.title}</Text>
        <Text className="text-zinc-400 text-base mt-2">{head.sub}</Text>

        {/* Period toggle */}
        <View className="flex-row bg-zinc-900 rounded-2xl p-1 mt-6">
          {(['yearly', 'monthly'] as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => setPeriod(p)}
              className="flex-1 rounded-xl py-2.5 items-center"
              style={{ backgroundColor: period === p ? '#27272a' : 'transparent' }}
            >
              <Text className="text-white text-sm font-semibold">
                {p === 'yearly' ? 'Yearly' : 'Monthly'}
                {p === 'yearly' && yearlySaving ? (
                  <Text className="text-green-400"> · save {yearlySaving}%</Text>
                ) : null}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Plan cards */}
        {(['pro', 'plus'] as Tier[]).map((t) => {
          const p = packages?.[SUBSCRIPTION_PRODUCTS[t][period]]
          const selected = tier === t
          const monthlyEquivalent = period === 'yearly' ? p?.product.pricePerMonthString : null
          return (
            <TouchableOpacity
              key={t}
              onPress={() => setTier(t)}
              activeOpacity={0.8}
              className="rounded-2xl p-4 mt-4"
              style={{
                borderWidth: 2,
                borderColor: selected ? (t === 'pro' ? '#facc15' : '#ffffff') : '#27272a',
                backgroundColor: '#0f0f11',
              }}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <Text className="text-white text-xl font-bold">{PLAN_NAMES[t]}</Text>
                  {current === t && (
                    <View className="bg-zinc-800 rounded-full px-2 py-0.5">
                      <Text className="text-zinc-300 text-xs">Current</Text>
                    </View>
                  )}
                  {t === 'pro' && current !== 'pro' && (
                    <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#facc15' }}>
                      <Text className="text-black text-xs font-semibold">Best value</Text>
                    </View>
                  )}
                </View>
                <View className="items-end">
                  <Text className="text-white text-base font-semibold">
                    {p ? `${p.product.priceString}/${perPeriod}` : '—'}
                  </Text>
                  {monthlyEquivalent && <Text className="text-zinc-500 text-xs">{monthlyEquivalent}/month</Text>}
                </View>
              </View>
              <View className="mt-3" style={{ gap: 6 }}>
                {FEATURES[t].map((f) => (
                  <View key={f} className="flex-row items-center" style={{ gap: 8 }}>
                    <Check size={16} color={t === 'pro' ? '#facc15' : '#a1a1aa'} strokeWidth={2.5} />
                    <Text className="text-zinc-200 text-sm">{f}</Text>
                  </View>
                ))}
              </View>
            </TouchableOpacity>
          )
        })}

        <Text className="text-zinc-500 text-xs mt-4">{FREE_LINE}</Text>
        <Text className="text-zinc-600 text-xs mt-1">
          *Fair use: up to 12 food scans a day, to keep the service fast for everyone.
        </Text>

        {!purchasesEnabled && (
          <Text className="text-amber-400 text-sm mt-6">Purchases aren't available in this build.</Text>
        )}
        {loadError && (
          <TouchableOpacity
            onPress={() => loadErrorDetail && Alert.alert('Details', loadErrorDetail)}
            activeOpacity={0.7}
          >
            <Text className="text-amber-400 text-sm mt-6">{loadError}</Text>
            <Text className="text-zinc-600 text-xs mt-1">Tap for details</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Buy */}
      <View className="px-5 pt-2">
        {current !== 'free' && isCurrent ? (
          <PressableScale haptic onPress={() => manageSubscription()} className="bg-zinc-800 rounded-2xl py-4 items-center">
            <Text className="text-white text-base font-semibold">Manage subscription</Text>
          </PressableScale>
        ) : (
          <PressableScale
            haptic
            onPress={buy}
            disabled={!pkg || !!busy}
            className="rounded-2xl py-4 items-center"
            style={{ backgroundColor: pkg ? (tier === 'pro' ? '#facc15' : '#ffffff') : '#3f3f46' }}
          >
            {busy === 'buy' ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text className="text-black text-base font-bold">
                {trial ? `Start ${trial}` : `Get ${PLAN_NAMES[tier]}`}
              </Text>
            )}
          </PressableScale>
        )}
        <Text className="text-zinc-500 text-xs text-center mt-2">
          {pkg
            ? trial
              ? `Free for the trial, then ${pkg.product.priceString}/${perPeriod}. Cancel anytime.`
              : `${pkg.product.priceString}/${perPeriod}. Cancel anytime.`
            : packages === null && purchasesEnabled && !loadError
              ? 'Loading prices…'
              : ' '}
        </Text>

        {/* Apple 3.1.2: auto-renew terms, restore, and legal links on the paywall */}
        <Text className="text-zinc-600 text-[10px] text-center mt-2 leading-4">
          Payment is charged to your Apple ID. The subscription renews automatically at the same price unless you
          cancel at least 24 hours before the end of the current period, in your Apple ID settings. Any unused
          part of a free trial ends when you subscribe.
        </Text>
        <View className="flex-row justify-center mt-2 mb-1" style={{ gap: 18 }}>
          <TouchableOpacity onPress={restore} hitSlop={8} disabled={!!busy}>
            <Text className="text-zinc-400 text-xs">{busy === 'restore' ? 'Restoring…' : 'Restore purchases'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => WebBrowser.openBrowserAsync(TERMS_OF_SERVICE_URL)} hitSlop={8}>
            <Text className="text-zinc-400 text-xs">Terms</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)} hitSlop={8}>
            <Text className="text-zinc-400 text-xs">Privacy</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}
