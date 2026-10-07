import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, Share, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useState } from 'react'
import { router } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Constants from 'expo-constants'
import { File, Paths } from 'expo-file-system'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { removeToken } from '../../lib/storage'
import { FEATURES } from '../../lib/featureFlags'
import { extractErrorMessage } from '../../lib/apiError'
import { PLAN_NAMES, openPaywall, usePlan, useSetPlan } from '../../hooks/usePlan'
import { usePreferences } from '../../hooks/usePreferences'
import { useSaveAvatar, useMyAvatar } from '../../hooks/useMyAvatar'
import { manageSubscription, restorePurchases } from '../../lib/purchases'
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL, SUPPORT_EMAIL } from '../../lib/legal'
import { disableNudges, enablePredictiveNudges, getNudgeStatus, nudgesOptedOut } from '../../lib/notifications'
import { UNIT_SYSTEM_LABEL, useUnits } from '../../lib/units'
import { formatNumber } from '../../lib/format'
import { AvatarBadge } from '../../components/avatar/AvatarBadge'
import { SettingsGroup } from '../../components/settings/SettingsGroup'
import { SettingsRow } from '../../components/settings/SettingsRow'
import { GOAL_LABEL, hourLabel } from '../../components/settings/labels'
import { colors } from '../../theme/tokens'

// Settings hub (DESIGN.md §6). Every row edits on its own screen or sheet and
// saves when confirmed or toggled — there is no global Save.

// ─── Profile row ────────────────────────────────────────────────────────────────

function ProfileRow() {
  const user = useAuthStore((s) => s.user)
  const { data: plan } = usePlan()
  const planLine = plan
    ? plan.plan === 'free'
      ? 'Free plan · Upgrade'
      : `${PLAN_NAMES[plan.plan]} plan`
    : ' '
  return (
    <SettingsGroup first>
      <SettingsRow
        title={user?.username ? `@${user.username}` : 'Your profile'}
        detail={planLine}
        leading={FEATURES.avatar ? <AvatarBadge size={48} /> : undefined}
        onPress={() => router.push('/settings/profile')}
      />
    </SettingsGroup>
  )
}

// ─── Goals & targets ───────────────────────────────────────────────────────────

function GoalsGroup() {
  const user = useAuthStore((s) => s.user)
  const { data: prefs } = usePreferences()
  const u = useUnits()
  const edit = (field: string) => router.push({ pathname: '/settings/edit/[field]', params: { field } })
  const choose = (field: string) => router.push({ pathname: '/settings/choose/[field]', params: { field } })
  return (
    <SettingsGroup header="Goals & targets">
      <SettingsRow title="Goal" value={prefs?.goal ? GOAL_LABEL[prefs.goal] : 'Not set'} onPress={() => choose('goal')} />
      <SettingsRow
        title="Calories"
        value={user?.calorie_target != null ? `${formatNumber(user.calorie_target)} kcal` : 'Not set'}
        onPress={() => edit('calories')}
      />
      <SettingsRow
        title="Protein"
        value={user?.protein_target_g != null ? `${formatNumber(Math.round(user.protein_target_g))} g` : 'Not set'}
        onPress={() => edit('protein')}
      />
      <SettingsRow
        title="Water"
        value={user?.water_target_ml != null ? `${formatNumber(u.water(user.water_target_ml))} ${u.waterUnit}` : 'Not set'}
        onPress={() => edit('water')}
      />
      <SettingsRow
        title="Bedtime"
        detail="Drives caffeine-at-night scoring"
        value={hourLabel(user?.sleep_hour ?? 23)}
        onPress={() => choose('bedtime')}
      />
    </SettingsGroup>
  )
}

// ─── Notifications ─────────────────────────────────────────────────────────────

interface PatternSlot {
  log_type: 'hydration' | 'stimulant'
  weekday: number
  slot_minute: number
  time_label: string
  confidence: number
  sample_count: number
  suggested_amount_ml: number | null
  suggested_substance: string | null
  suggested_caffeine_mg: number | null
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function formatTime12h(slotMin: number): string {
  const h = Math.floor(slotMin / 60)
  const m = slotMin % 60
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:${m.toString().padStart(2, '0')} ${period}`
}

function NotificationsGroup() {
  const qc = useQueryClient()
  const u = useUnits()

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['nudge-status'],
    queryFn: async () => ({ ...(await getNudgeStatus()), optedOut: await nudgesOptedOut() }),
  })
  const granted = !!status?.granted
  const nudgesOn = granted && !status?.optedOut

  // Only fetch patterns when nudges are on — saves a roundtrip.
  const { data: slots, isLoading: slotsLoading } = useQuery<PatternSlot[]>({
    queryKey: ['notif-patterns'],
    queryFn: () => api.get('/notifications/patterns').then((r) => r.data),
    enabled: nudgesOn,
  })

  const enable = useMutation({
    mutationFn: enablePredictiveNudges,
    onSuccess: (result) => {
      if (result.enabled) qc.invalidateQueries({ queryKey: ['notif-patterns'] })
      else if (result.reason === 'permission_denied') {
        Alert.alert('Notifications are off', 'Allow notifications for GainRace in Settings to get nudges.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ])
      }
      refetchStatus()
    },
  })

  const disable = useMutation({
    mutationFn: disableNudges,
    onSuccess: () => {
      refetchStatus()
      qc.removeQueries({ queryKey: ['notif-patterns'] })
    },
  })

  function onNotificationsRow() {
    // Granted, or denied for good: only iOS Settings can change it.
    if (granted || status?.canAskAgain === false) Linking.openSettings()
    else enable.mutate()
  }

  function slotSummary(s: PatternSlot): string {
    if (s.log_type === 'hydration') {
      return s.suggested_amount_ml ? `${formatNumber(u.water(s.suggested_amount_ml))} ${u.waterUnit} water` : 'Water'
    }
    const label = s.suggested_substance
      ? s.suggested_substance.charAt(0).toUpperCase() + s.suggested_substance.slice(1)
      : 'Coffee'
    return s.suggested_caffeine_mg ? `${label} (${s.suggested_caffeine_mg} mg)` : label
  }

  // A preview of what we'd nudge for, not the full list.
  const previewSlots = (slots ?? []).slice(0, 6)
  const busy = enable.isPending || disable.isPending

  return (
    <>
      <SettingsGroup
        header="Notifications"
        footer="Smart nudges remind you when you usually log water or coffee, with a Log button in the notification."
      >
        <SettingsRow title="Notifications" value={status ? (granted ? 'On' : 'Off') : undefined} onPress={onNotificationsRow} />
        <SettingsRow
          title="Smart nudges"
          switchValue={nudgesOn}
          loading={busy}
          onSwitch={(on) => (on ? enable.mutate() : disable.mutate())}
        />
      </SettingsGroup>
      {nudgesOn && (
        <SettingsGroup header="Nudge times">
          {slotsLoading ? (
            <View className="py-3 items-center">
              <ActivityIndicator color={colors['text-subtle']} />
            </View>
          ) : previewSlots.length === 0 ? (
            <Text className="text-text-subtle text-footnote px-4 py-3">
              Not enough log history yet. Times appear after about 3 weeks of regular logging.
            </Text>
          ) : (
            previewSlots.map((s) => (
              <SettingsRow
                key={`${s.log_type}-${s.weekday}-${s.slot_minute}`}
                title={`${WEEKDAY_SHORT[s.weekday]} ${formatTime12h(s.slot_minute)}`}
                value={slotSummary(s)}
              />
            ))
          )}
        </SettingsGroup>
      )}
    </>
  )
}

// ─── Subscription ──────────────────────────────────────────────────────────────

function SubscriptionGroup() {
  const { data: plan } = usePlan()
  const setPlan = useSetPlan()
  const [restoring, setRestoring] = useState(false)
  if (!plan) return null
  const paid = plan.plan !== 'free'
  const { food, bf, ask } = plan.scans
  const renews = plan.plan_expires_at
    ? new Date(plan.plan_expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  async function restore() {
    setRestoring(true)
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
      setRestoring(false)
    }
  }

  const usage =
    `${food.remaining}/${food.limit} food scans left ${food.window === 'day' ? 'today' : 'this week'} · ` +
    `${bf.remaining}/${bf.limit} body fat scans ${bf.window === 'day' ? 'today' : 'this week'} · ` +
    `${ask.remaining}/${ask.limit} questions · ${plan.friends.count}/${plan.friends.limit} friends` +
    (paid && renews ? `. Renews or ends ${renews}.` : '')

  return (
    <SettingsGroup header="Subscription" footer={usage}>
      <SettingsRow title="Plan" value={PLAN_NAMES[plan.plan]} onPress={() => openPaywall()} />
      {paid && <SettingsRow title="Manage subscription" onPress={() => manageSubscription()} />}
      <SettingsRow title="Restore purchases" chevron={false} loading={restoring} onPress={restore} />
    </SettingsGroup>
  )
}

// ─── Privacy & data ────────────────────────────────────────────────────────────

function PrivacyGroup() {
  const { data: plan } = usePlan()
  const { config, hasSaved } = useMyAvatar()
  const saveAvatar = useSaveAvatar()
  const [busy, setBusy] = useState(false)
  const shareBody = config.share_body ?? true

  async function exportData() {
    if (busy) return
    if (!plan?.export) {
      openPaywall('export')
      return
    }
    setBusy(true)
    try {
      const token = useAuthStore.getState().accessToken
      const stamp = new Date().toISOString().slice(0, 10)
      const file = await File.downloadFileAsync(
        `${api.defaults.baseURL}/users/me/export`,
        new File(Paths.cache, `gainrace-export-${stamp}.zip`),
        { headers: { Authorization: `Bearer ${token}` }, idempotent: true },
      )
      // iOS share sheet: save to Files, AirDrop, mail it to yourself.
      await Share.share({ url: file.uri, title: 'GainRace export' })
    } catch (e) {
      Alert.alert("Couldn't export", extractErrorMessage(e, 'Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsGroup header="Privacy & data" footer="Friends never see your weight or body fat. With body shape off they see your colors on a neutral body.">
      {FEATURES.avatar && (
        <SettingsRow
          title="Show body shape to friends"
          switchValue={shareBody}
          loading={saveAvatar.isPending}
          // Saving needs an avatar; until one exists the default (on) applies.
          disabled={!hasSaved}
          onSwitch={(v) =>
            saveAvatar.mutate(
              { ...config, share_body: v },
              { onError: (e) => Alert.alert("Couldn't save", extractErrorMessage(e, 'Try again in a moment.')) },
            )
          }
        />
      )}
      <SettingsRow
        title={busy ? 'Preparing your file…' : 'Export data (CSV)'}
        detail="A zip of your logs, one spreadsheet per type"
        value={plan?.export ? undefined : 'Pro'}
        loading={busy}
        onPress={exportData}
      />
    </SettingsGroup>
  )
}

// ─── Delete account (Apple Guideline 5.1.1(v)) ─────────────────────────────────

function DeleteAccountGroup() {
  const { user, clearAuth } = useAuthStore()
  const [step, setStep] = useState<'idle' | 'confirming' | 'submitting'>('idle')
  const [typed, setTyped] = useState('')

  const email = user?.email ?? ''
  // Typing the email was painful for Apple "Hide My Email" relay addresses, so
  // we ask for the word DELETE instead. Case-insensitive + trimmed since iOS
  // keyboards capitalize and autocomplete adds a trailing space.
  const matches = typed.trim().toUpperCase() === 'DELETE'

  async function submit() {
    if (!matches) return
    setStep('submitting')
    try {
      await api.delete('/users/me', { data: { confirmation: 'DELETE' } })
      await removeToken('refresh_token')
      clearAuth()
      router.replace('/login')
    } catch (e: any) {
      const detail = e?.response?.data?.detail
      Alert.alert(
        'Delete failed',
        typeof detail === 'string' ? detail : 'Could not delete your account. Try again or contact support.',
      )
      setStep('confirming')
    }
  }

  if (step === 'idle') {
    return (
      <SettingsGroup>
        <SettingsRow
          title="Delete account"
          destructive
          onPress={() =>
            Alert.alert(
              'Delete your account?',
              'This permanently deletes your account, all logs, friendships, photos, and AI history. You cannot undo this.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Continue', style: 'destructive', onPress: () => setStep('confirming') },
              ],
            )
          }
        />
      </SettingsGroup>
    )
  }

  return (
    <SettingsGroup>
      <View className="px-4 py-4">
        <Text className="text-danger text-body font-semibold mb-1">Type DELETE to confirm</Text>
        <Text className="text-text-subtle text-footnote mb-3">
          Account: <Text className="text-text-muted">{email || '—'}</Text>
        </Text>
        <TextInput
          value={typed}
          onChangeText={setTyped}
          placeholder="DELETE"
          placeholderTextColor={colors['text-subtle']}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={step !== 'submitting'}
          className="bg-surface-raised border border-border rounded-md px-3 py-3 text-text text-body mb-3"
          style={{ borderCurve: 'continuous' }}
        />
        <View className="flex-row gap-2">
          <TouchableOpacity
            onPress={() => {
              setStep('idle')
              setTyped('')
            }}
            disabled={step === 'submitting'}
            className="flex-1 bg-surface-raised rounded-md py-3 items-center"
            style={{ borderCurve: 'continuous' }}
          >
            <Text className="text-text text-body font-medium">Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={submit}
            disabled={!matches || step === 'submitting'}
            className="flex-1 rounded-md py-3 items-center"
            style={{ borderCurve: 'continuous', backgroundColor: matches && step !== 'submitting' ? colors.danger : colors.border }}
          >
            {step === 'submitting' ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text className="text-text text-body font-semibold">Delete forever</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SettingsGroup>
  )
}

// ─── Settings screen ───────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const u = useUnits()

  // expoConfig is the source of truth at runtime — version and buildNumber
  // come from app.json (production) or eas-update overrides (in OTA-pushed
  // builds). Constants.nativeBuildVersion is the iOS CFBundleVersion.
  const version = Constants.expoConfig?.version ?? '—'
  const build = Constants.expoConfig?.ios?.buildNumber ?? Constants.nativeBuildVersion ?? '—'

  function signOut() {
    Alert.alert('Sign out', 'You can sign back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await removeToken('refresh_token')
          clearAuth()
          router.replace('/login')
        },
      },
    ])
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-bg" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="px-4 pt-4 pb-12"
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <ProfileRow />
        <GoalsGroup />

        <SettingsGroup header="Preferences">
          <SettingsRow
            title="Training preferences"
            detail="Equipment, experience, session length, injuries"
            onPress={() => router.push('/settings/training')}
          />
          <SettingsRow
            title="Nutrition preferences"
            detail="Diet, allergies, foods to avoid, cooking, health"
            onPress={() => router.push('/settings/nutrition')}
          />
          <SettingsRow title="Units" value={UNIT_SYSTEM_LABEL[u.system]} onPress={() => router.push('/settings/units')} />
        </SettingsGroup>

        {FEATURES.avatar && (
          <SettingsGroup header="Avatar">
            <SettingsRow title="Customize avatar" onPress={() => router.push('/avatar-edit')} />
          </SettingsGroup>
        )}

        <NotificationsGroup />
        <SubscriptionGroup />
        <PrivacyGroup />

        <SettingsGroup header="Help">
          <SettingsRow
            title="How GainRace works"
            detail="Form score, DOTS, caffeine curve, PR detection — formulas and sources"
            onPress={() => router.push('/methodology')}
          />
          <SettingsRow title="Contact support" chevron={false} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
          <SettingsRow title="Privacy policy" chevron={false} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} />
          <SettingsRow title="Terms of service" chevron={false} onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)} />
        </SettingsGroup>

        {/* Internal renderer instrumentation: dev builds only (DESIGN.md §5 Cleanup). */}
        {__DEV__ && (
          <SettingsGroup header="Developer">
            <SettingsRow title="Avatar lab" detail="Placeholder model, FPS and snapshot timing" onPress={() => router.push('/avatar-lab')} />
          </SettingsGroup>
        )}

        <SettingsGroup header="Account">
          <SettingsRow title="Sign out" chevron={false} onPress={signOut} />
        </SettingsGroup>

        <DeleteAccountGroup />

        <Text className="text-text-subtle text-footnote text-center mt-6">
          Version {version} (build {build})
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
