import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { Check } from 'lucide-react-native'
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
import { colors } from '../theme/tokens'

type Tier = 'plus' | 'pro'
type Period = 'monthly' | 'yearly'

// Mirrors backend/services/plans.py. Pro's food cap is fair use, stated in the footnote.
const FEATURES: Record<Tier, string[]> = {
  plus: [
    '4 food scans a day',
    '3 body-fat scans a week',
    '15 AI questions a day',
    'A new Pit Crew plan every week',
    '90 days of trends',
    'Up to 50 friends',
  ],
  pro: [
    'Unlimited food scans*',
    'A body-fat scan every day',
    '50 AI questions a day',
    '3 Pit Crew plans a week',
    'A full year of trends',
    'Export your data',
    'Up to 150 friends',
    'Emote packs at a discount',
  ],
}
const FREE_LINE =
  'Free: 1 food scan a day, 1 body-fat scan a week, 3 questions a day, 1 Pit Crew plan to try, 30 days of trends, 15 friends.'

const HEADLINES: Record<PaywallReason | 'default', { title: string; sub: string }> = {
  food: { title: "You've used today's food scan", sub: 'Upgrade to keep snapping meals.' },
  bf: { title: "You've used this week's body-fat scan", sub: 'Upgrade to track your progress more often.' },
  ask: { title: "You've used today's questions", sub: 'Upgrade to keep asking about your data.' },
  plan: { title: "You've used your plan builds", sub: 'Upgrade for a fresh Pit Crew plan every week.' },
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
    <SafeAreaView className="flex-1 bg-bg" edges={['bottom']}>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="py-2">
              <Text className="text-text text-body">Cancel</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView className="flex-1 px-5" contentContainerClassName="pb-6">
        <Text className="text-text text-title font-bold mt-4">{head.title}</Text>
        <Text className="text-text-muted text-body mt-2">{head.sub}</Text>

        {/* Period toggle */}
        <View className="flex-row bg-surface rounded-full p-1 mt-6" style={{ borderCurve: 'continuous' }}>
          {(['yearly', 'monthly'] as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => setPeriod(p)}
              className="flex-1 rounded-full py-3 items-center"
              style={{ borderCurve: 'continuous', backgroundColor: period === p ? colors.text : 'transparent' }}
            >
              <Text className="text-footnote font-semibold" style={{ color: period === p ? colors.bg : colors.text }}>
                {p === 'yearly' ? 'Yearly' : 'Monthly'}
                {p === 'yearly' && yearlySaving ? (
                  <Text style={{ color: period === p ? colors.bg : colors.success }}> · save {yearlySaving}%</Text>
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
              className="rounded-xl p-4 mt-4"
              style={{
                borderCurve: 'continuous',
                borderWidth: 2,
                borderColor: selected ? colors.accent : colors.divider,
                backgroundColor: colors.surface,
              }}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <Text className="text-text text-headline font-bold">{PLAN_NAMES[t]}</Text>
                  {current === t && (
                    <View className="bg-surface-raised rounded-full px-2 py-1" style={{ borderCurve: 'continuous' }}>
                      <Text className="text-text-muted text-caption">Current</Text>
                    </View>
                  )}
                  {t === 'pro' && current !== 'pro' && (
                    <View className="bg-accent rounded-full px-2 py-1" style={{ borderCurve: 'continuous' }}>
                      <Text className="text-on-accent text-caption font-semibold">Best value</Text>
                    </View>
                  )}
                </View>
                <View className="items-end">
                  <Text className="text-text text-body font-semibold">
                    {p ? `${p.product.priceString}/${perPeriod}` : '—'}
                  </Text>
                  {monthlyEquivalent && <Text className="text-text-subtle text-caption">{monthlyEquivalent}/month</Text>}
                </View>
              </View>
              <View className="mt-3 gap-2">
                {FEATURES[t].map((f) => (
                  <View key={f} className="flex-row items-center gap-2">
                    <Check size={16} color={t === 'pro' ? colors.accent : colors['text-muted']} strokeWidth={2.5} />
                    <Text className="text-text text-footnote">{f}</Text>
                  </View>
                ))}
              </View>
            </TouchableOpacity>
          )
        })}

        <Text className="text-text-subtle text-caption mt-4">{FREE_LINE}</Text>
        <Text className="text-text-subtle text-caption mt-1">
          *Fair use: up to 12 food scans a day, to keep the service fast for everyone.
        </Text>

        {!purchasesEnabled && (
          <Text className="text-warning text-footnote mt-6">Purchases aren't available in this build.</Text>
        )}
        {loadError && (
          <TouchableOpacity
            onPress={() => loadErrorDetail && Alert.alert('Details', loadErrorDetail)}
            activeOpacity={0.7}
          >
            <Text className="text-warning text-footnote mt-6">{loadError}</Text>
            <Text className="text-text-subtle text-caption mt-1">Tap for details</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Buy */}
      <View className="px-5 pt-2">
        {current !== 'free' && isCurrent ? (
          <PressableScale haptic onPress={() => manageSubscription()} className="bg-surface-raised rounded-md py-4 items-center" style={{ borderCurve: 'continuous' }}>
            <Text className="text-text text-body font-semibold">Manage subscription</Text>
          </PressableScale>
        ) : (
          <PressableScale
            haptic
            onPress={buy}
            disabled={!pkg || !!busy}
            className={`rounded-md py-4 items-center ${tier === 'pro' ? '' : 'border border-text'}`}
            style={{ borderCurve: 'continuous', backgroundColor: !pkg ? colors.border : tier === 'pro' ? colors.accent : 'transparent' }}
          >
            {busy === 'buy' ? (
              <ActivityIndicator color={tier === 'pro' ? colors['on-accent'] : colors.text} />
            ) : (
              <Text className={`${tier === 'pro' ? 'text-on-accent' : 'text-text'} text-body font-bold`}>
                {trial ? `Start ${trial}` : `Get ${PLAN_NAMES[tier]}`}
              </Text>
            )}
          </PressableScale>
        )}
        <Text className="text-text-subtle text-caption text-center mt-2">
          {pkg
            ? trial
              ? `Free for the trial, then ${pkg.product.priceString}/${perPeriod}. Cancel anytime.`
              : `${pkg.product.priceString}/${perPeriod}. Cancel anytime.`
            : packages === null && purchasesEnabled && !loadError
              ? 'Loading prices…'
              : ' '}
        </Text>

        {/* Apple 3.1.2: auto-renew terms, restore, and legal links on the paywall */}
        <Text className="text-text-subtle text-caption text-center mt-2">
          Payment is charged to your Apple ID. The subscription renews automatically at the same price unless you
          cancel at least 24 hours before the end of the current period, in your Apple ID settings. Any unused
          part of a free trial ends when you subscribe.
        </Text>
        <View className="flex-row justify-center mt-2 mb-1 gap-4">
          <TouchableOpacity onPress={restore} hitSlop={8} disabled={!!busy}>
            <Text className="text-text-muted text-caption">{busy === 'restore' ? 'Restoring…' : 'Restore purchases'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => WebBrowser.openBrowserAsync(TERMS_OF_SERVICE_URL)} hitSlop={8}>
            <Text className="text-text-muted text-caption">Terms</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)} hitSlop={8}>
            <Text className="text-text-muted text-caption">Privacy</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}
