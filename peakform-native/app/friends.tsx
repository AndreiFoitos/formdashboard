import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  Share,
} from 'react-native'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Award, ChevronLeft, HelpCircle, MoreHorizontal, Trophy, X } from 'lucide-react-native'
import { api } from '../api/client'
import { useExerciseName } from '../hooks/useExerciseName'
import { useAuthStore } from '../store/auth'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { SkeletonCard } from '../components/Skeleton'
import { PressableScale } from '../components/PressableScale'
import { hapticSuccess, hapticLight, hapticSelection } from '../lib/haptics'
import { TrustedShield } from '../components/icons/TrustedShield'
import { SusFace } from '../components/icons/SusFace'
import { extractErrorMessage } from '../lib/apiError'
import { PLAN_KEY, handleLimitError } from '../hooks/usePlan'
import { colors } from '../theme/tokens'

// ─── Exercise catalogue (mirror of training.tsx for the picker) ──────────────

const EXERCISES: { key: string; name: string }[] = [
  { key: 'bench_press',      name: 'Bench Press' },
  { key: 'incline_bench',    name: 'Incline Bench' },
  { key: 'dumbbell_press',   name: 'Dumbbell Press' },
  { key: 'chest_fly',        name: 'Chest Fly' },
  { key: 'push_up',          name: 'Push-up' },
  { key: 'deadlift',         name: 'Deadlift' },
  { key: 'barbell_row',      name: 'Barbell Row' },
  { key: 'pull_up',          name: 'Pull-up' },
  { key: 'lat_pulldown',     name: 'Lat Pulldown' },
  { key: 'cable_row',        name: 'Cable Row' },
  { key: 'squat',            name: 'Squat' },
  { key: 'front_squat',      name: 'Front Squat' },
  { key: 'leg_press',        name: 'Leg Press' },
  { key: 'romanian_dl',      name: 'Romanian Deadlift' },
  { key: 'leg_curl',         name: 'Leg Curl' },
  { key: 'leg_extension',    name: 'Leg Extension' },
  { key: 'calf_raise',       name: 'Calf Raise' },
  { key: 'overhead_press',   name: 'Overhead Press' },
  { key: 'lateral_raise',    name: 'Lateral Raise' },
  { key: 'rear_delt_fly',    name: 'Rear Delt Fly' },
  { key: 'face_pull',        name: 'Face Pull' },
  { key: 'bicep_curl',       name: 'Bicep Curl' },
  { key: 'hammer_curl',      name: 'Hammer Curl' },
  { key: 'tricep_extension', name: 'Tricep Extension' },
  { key: 'tricep_pushdown',  name: 'Tricep Pushdown' },
  { key: 'tricep_dip',       name: 'Tricep Dip' },
]
const EXERCISE_NAME: Record<string, string> = Object.fromEntries(EXERCISES.map(e => [e.key, e.name]))

// ─── Types ───────────────────────────────────────────────────────────────────

interface FriendUser {
  id: string
  name: string
  username: string | null
}

interface FriendshipRow {
  id: string
  status: 'pending' | 'accepted'
  created_at: string
  user: FriendUser
}

interface FriendsList {
  friends: FriendshipRow[]
  pending_in: FriendshipRow[]
  pending_out: FriendshipRow[]
}

interface LeaderboardRow {
  user: FriendUser
  total_volume_kg: number
  dots_volume: number | null    // bodyweight-adjusted, null if missing sex/weight
  days_trained: number
  sus_votes: number             // weekly votes count
  sus_per_lift_votes: number    // count of per-lift votes against target
  sus_score: number             // weekly + per_lift × 2
  sus_threshold: number
  is_sus: boolean
  vouches: number
  is_trusted: boolean
  i_sus_weekly: boolean         // did the viewer cast a weekly sus this week
  i_vouched: boolean            // did the viewer vouch this week
  is_me: boolean
  rank: number
}

interface LeaderboardResponse {
  week_start: string
  week_end: string
  exercise: string | null
  sort: 'raw' | 'dots'
  sus_threshold: number
  rows: LeaderboardRow[]
}

interface FriendLift {
  id: string
  date: string
  type: string
  weight_kg: number | null
  reps: number | null
  already_sus: boolean
  already_vouched: boolean
}

interface InviteLink {
  id: string
  token: string
  deep_link: string
  created_at: string
  expires_at: string
  joined_count: number
}

interface InvitesResponse {
  invites: InviteLink[]
  active_count: number
  cap: number
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

// ─── Sus + Vouch bottom sheet ────────────────────────────────────────────────
//
// Symmetric voting model: every scope is binary — Approve (TrustedShield) or
// Sus (SusFace).
// - Weekly scope acts on the friend's weight-moved total for the week.
// - Per-lift scope acts on one specific TrainingLog (last 7 days).
//
// Approve = one-tap vouch (instant, toggleable).
// Sus     = one-tap (instant, toggleable) — symmetric with Approve.

function SusVouchSheet({
  target,
  onClose,
}: {
  target: LeaderboardRow
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'weekly' | 'per_lift'>('weekly')

  // Lifts only fetched when needed.
  const liftsQuery = useQuery<{ lifts: FriendLift[] }>({
    queryKey: ['friend-lifts', target.user.id],
    queryFn: () => api.get(`/friends/friend-lifts/${target.user.id}`).then((r) => r.data),
    enabled: mode === 'per_lift',
  })

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['friends-leaderboard'] })
    qc.invalidateQueries({ queryKey: ['friend-lifts', target.user.id] })
  }

  // Sus is now a one-tap toggle, symmetric with vouch — no reason picker.
  // Posting again with the same scope clears the vote (handled server-side).
  const susMutation = useMutation({
    mutationFn: (training_log_id: string | null) =>
      api.post(`/friends/vote-sus/${target.user.id}`, { training_log_id }),
    onSuccess: (_data, training_log_id) => {
      hapticSuccess()
      invalidateAll()
      // Weekly vote → drop back to the leaderboard. Per-lift stays open so the
      // voter can rattle through several lifts without reopening the sheet.
      if (training_log_id === null) onClose()
    },
  })

  const vouchMutation = useMutation({
    mutationFn: (training_log_id: string | null) =>
      api.post(`/friends/vouch/${target.user.id}`, { training_log_id }),
    onSuccess: (_data, training_log_id) => {
      hapticSuccess()
      invalidateAll()
      if (training_log_id === null) onClose()
    },
  })

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-surface">
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 bg-border rounded-full" style={{ borderCurve: 'continuous' }} />
        </View>
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-divider">
          <View>
            <Text className="text-text font-semibold">{target.user.name}</Text>
            <Text className="text-text-subtle text-caption mt-1">
              {target.total_volume_kg.toLocaleString()} kg this week
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            className="w-10 h-10 -mr-1 rounded-full bg-surface-raised border border-border items-center justify-center" style={{ borderCurve: 'continuous' }}
          >
            <X size={20} color={colors.text} strokeWidth={2.25} />
          </TouchableOpacity>
        </View>

        <ScrollView
          className="flex-1 px-4 pt-4"
          contentContainerClassName="pb-8"
          keyboardShouldPersistTaps="handled"
        >
          {/* Scope toggle */}
          <View className="flex-row bg-surface-raised border border-border rounded-full p-1 mb-4" style={{ borderCurve: 'continuous' }}>
            {(['weekly', 'per_lift'] as const).map((m) => {
              const active = mode === m
              return (
                <TouchableOpacity
                  key={m}
                  onPress={() => {
                    hapticSelection()
                    setMode(m)
                  }}
                  className="flex-1 py-2 items-center rounded-full"
                  style={{ borderCurve: 'continuous', backgroundColor: active ? colors.text : 'transparent' }}
                >
                  <Text
                    className="text-caption font-medium"
                    style={{ color: active ? colors.bg : colors['text-muted'] }}
                  >
                    {m === 'weekly' ? 'Whole week' : 'A specific lift'}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* Weekly scope — two big action buttons. */}
          {mode === 'weekly' && (
            <View className="gap-3">
              <ActionButton
                kind="approve"
                active={target.i_vouched}
                label={target.i_vouched ? 'Approved this week' : 'Approve the week'}
                sub="Endorse their weight moved total"
                onPress={() => { hapticLight(); vouchMutation.mutate(null) }}
                busy={vouchMutation.isPending}
              />
              <ActionButton
                kind="sus"
                active={target.i_sus_weekly}
                label={target.i_sus_weekly ? "Sus'd this week" : 'Sus the week'}
                sub={target.i_sus_weekly ? 'Tap to take it back' : 'Flag their weight moved as sus'}
                onPress={() => { hapticLight(); susMutation.mutate(null) }}
                busy={susMutation.isPending}
              />
            </View>
          )}

          {/* Per-lift scope — list with both actions per lift. */}
          {mode === 'per_lift' && (
            <View>
              <Text className="text-text-subtle text-caption mb-2">
                Last 7 days
              </Text>
              {liftsQuery.isLoading ? (
                <ActivityIndicator color={colors['text-subtle']} />
              ) : (liftsQuery.data?.lifts.length ?? 0) === 0 ? (
                <View className="bg-surface-raised border border-border rounded-xl p-4 items-center" style={{ borderCurve: 'continuous' }}>
                  <Text className="text-text-subtle text-caption">No lifts in the last 7 days</Text>
                </View>
              ) : (
                <View className="gap-2">
                  {(liftsQuery.data?.lifts ?? []).map((lift) => (
                    <LiftRowSusVouch
                      key={lift.id}
                      lift={lift}
                      onApprove={() => { hapticLight(); vouchMutation.mutate(lift.id) }}
                      onSus={() => { hapticLight(); susMutation.mutate(lift.id) }}
                      busy={vouchMutation.isPending || susMutation.isPending}
                    />
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>

      </View>
    </Modal>
  )
}

function ActionButton({
  kind,
  active,
  label,
  sub,
  onPress,
  busy,
}: {
  kind: 'approve' | 'sus'
  active: boolean
  label: string
  sub: string
  onPress: () => void
  busy?: boolean
}) {
  const isApprove = kind === 'approve'
  // Active = the viewer has already cast this action in this scope.
  const bg = active ? `${isApprove ? colors.success : colors.warning}26` : colors['surface-raised']
  const border = active ? `${isApprove ? colors.success : colors.warning}66` : colors.border
  const fg = active ? (isApprove ? colors.success : colors.warning) : colors.text
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      className="rounded-xl px-4 py-4 flex-row items-center justify-between"
      style={{ borderCurve: 'continuous', backgroundColor: bg, borderWidth: 1, borderColor: border }}
    >
      <View className="flex-1 pr-3">
        <View className="flex-row items-center gap-2">
          {isApprove ? <TrustedShield size={14} /> : <SusFace size={14} />}
          <Text className="text-footnote font-semibold" style={{ color: fg }}>
            {label}
          </Text>
        </View>
        <Text className="text-text-subtle text-caption mt-1">{sub}</Text>
      </View>
      {busy && <ActivityIndicator color={colors['text-muted']} />}
    </TouchableOpacity>
  )
}

function LiftRowSusVouch({
  lift,
  onApprove,
  onSus,
  busy,
}: {
  lift: FriendLift
  onApprove: () => void
  onSus: () => void
  busy?: boolean
}) {
  const displayName = useExerciseName(EXERCISE_NAME)
  return (
    <View className="rounded-xl bg-surface-raised border border-border px-4 py-3 flex-row items-center" style={{ borderCurve: 'continuous' }}>
      <View className="flex-1 pr-2">
        <Text className="text-text text-footnote font-semibold">
          {displayName(lift.type)}
        </Text>
        <Text className="text-text-subtle text-caption mt-1">
          {new Date(lift.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          {' · '}
          {lift.weight_kg ?? '–'}kg × {lift.reps ?? '–'}
        </Text>
      </View>
      <View className="flex-row gap-2">
        <PillButton
          active={lift.already_vouched}
          kind="trusted"
          tintActive={`${colors.success}26`}
          fgActive={colors.success}
          onPress={onApprove}
          disabled={busy}
        />
        <PillButton
          active={lift.already_sus}
          kind="sus"
          tintActive={`${colors.warning}26`}
          fgActive={colors.warning}
          onPress={onSus}
        />
      </View>
    </View>
  )
}

function PillButton({
  active,
  kind,
  tintActive,
  fgActive,
  onPress,
  disabled,
}: {
  active: boolean
  kind: 'trusted' | 'sus'
  tintActive: string
  fgActive: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      className="px-3 py-2 rounded-full"
      style={{
        borderCurve: 'continuous',
        backgroundColor: active ? tintActive : colors['surface-raised'],
        borderWidth: 1,
        borderColor: active ? fgActive : colors.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {kind === 'trusted' ? <TrustedShield size={14} /> : <SusFace size={14} />}
    </TouchableOpacity>
  )
}

// ─── Leaderboard tab ─────────────────────────────────────────────────────────

function LeaderboardTab() {
  const [exercise, setExercise] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sheetFor, setSheetFor] = useState<LeaderboardRow | null>(null)

  const path = exercise
    ? `/friends/leaderboard?exercise=${encodeURIComponent(exercise)}`
    : '/friends/leaderboard'

  const { data, isLoading, refetch, isRefetching } = useQuery<LeaderboardResponse>({
    queryKey: ['friends-leaderboard', exercise],
    queryFn: () => api.get(path).then(r => r.data),
  })

  const rows = data?.rows ?? []
  const maxVol = Math.max(1, ...rows.map(r => r.total_volume_kg))

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="p-4 pb-8"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.text} />}
    >
      {/* Exercise filter */}
      <View className="mb-4 flex-row items-center gap-2">
        <Text className="text-text-muted text-caption flex-1 font-semibold">
          {exercise ? `By exercise` : `Total weekly volume`}
        </Text>
        <TouchableOpacity
          onPress={() => setPickerOpen(true)}
          hitSlop={8}
          className="flex-row items-center gap-2 px-4 py-2 rounded-full border border-border" style={{ borderCurve: 'continuous' }}
        >
          <Text className="text-text text-footnote font-medium">
            {exercise ? EXERCISE_NAME[exercise] : 'All exercises'}
          </Text>
          <Text className="text-text-muted text-footnote">▾</Text>
        </TouchableOpacity>
      </View>


      {isLoading ? (
        <View className="gap-3">
          <SkeletonCard height={88} />
          <SkeletonCard height={88} />
          <SkeletonCard height={88} />
        </View>
      ) : rows.length === 0 ? (
        <View className="bg-surface border border-divider rounded-xl p-8 items-center" style={{ borderCurve: 'continuous' }}>
          <Text className="text-text-muted text-body font-medium">No data yet</Text>
          <Text className="text-text-subtle text-footnote mt-1 text-center">
            Add friends and log workouts to see the leaderboard
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {rows.map(row => {
            const pct = (row.total_volume_kg / maxVol) * 100
            const medal = row.rank === 1 ? { Icon: Trophy, color: colors.medal.gold }
                        : row.rank === 2 ? { Icon: Award,  color: colors.medal.silver }
                        : row.rank === 3 ? { Icon: Award,  color: colors.medal.bronze }
                        : null
            return (
              <View
                key={row.user.id}
                className="bg-surface border border-divider rounded-xl p-4"
                style={{ borderCurve: 'continuous', ...(row.is_me && { borderColor: colors['text-subtle'], borderWidth: 1.5 }) }}
              >
                <View className="flex-row items-center gap-4">
                  <View className="w-9 items-center">
                    {medal
                      ? <medal.Icon size={26} color={medal.color} strokeWidth={2} />
                      : <Text className="text-text-muted text-headline font-semibold">{row.rank}</Text>}
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2 flex-wrap">
                      <Text className="text-text text-body font-semibold">
                        {row.user.name}{row.is_me ? ' (you)' : ''}
                      </Text>
                      {row.is_trusted && (
                        <View
                          className="px-2 py-1 rounded-full flex-row items-center gap-1"
                          style={{
                            borderCurve: 'continuous',
                            backgroundColor: `${colors.success}26`,
                            borderWidth: 1,
                            borderColor: `${colors.success}66`,
                          }}
                        >
                          <TrustedShield size={14} />
                          <Text className="text-caption font-semibold" style={{ color: colors.success }}>
                            {row.vouches}
                          </Text>
                        </View>
                      )}
                      {(row.sus_score > 0 || row.is_sus) && (
                        <View
                          className="px-2 py-1 rounded-full flex-row items-center gap-1"
                          style={{
                            borderCurve: 'continuous',
                            backgroundColor: row.is_sus ? `${colors.warning}26` : colors['surface-raised'],
                            borderWidth: 1,
                            borderColor: row.is_sus ? `${colors.warning}66` : colors.border,
                          }}
                        >
                          <SusFace size={14} />
                          <Text
                            className="text-caption font-semibold"
                            style={{ color: row.is_sus ? colors.warning : colors['text-muted'] }}
                          >
                            {row.sus_score} / {row.sus_threshold}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-text-subtle text-footnote mt-1">
                      {row.days_trained} day{row.days_trained === 1 ? '' : 's'} this week
                      {row.sus_per_lift_votes > 0 && ` · ${row.sus_per_lift_votes} lift${row.sus_per_lift_votes === 1 ? '' : 's'} sus'd`}
                    </Text>
                  </View>
                  <View className="items-end" style={{ minWidth: 88 }}>
                    <Text className="text-text text-headline font-bold">
                      {row.total_volume_kg.toLocaleString()}
                      <Text className="text-text-subtle text-caption font-normal"> kg</Text>
                    </Text>
                    <Text className="text-text-muted text-footnote font-semibold mt-1">
                      {row.dots_volume != null ? row.dots_volume.toLocaleString() : '—'}
                      <Text className="text-text-subtle text-caption font-normal"> DOTS</Text>
                    </Text>
                  </View>
                  {!row.is_me && (
                    <TouchableOpacity
                      onPress={() => { hapticLight(); setSheetFor(row) }}
                      hitSlop={12}
                      className="ml-1 w-10 h-10 rounded-full items-center justify-center"
                      style={{ borderCurve: 'continuous', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                    >
                      {row.i_vouched
                        ? <TrustedShield size={22} />
                        : row.i_sus_weekly
                          ? <SusFace size={22} />
                          : <HelpCircle size={22} color={colors['text-muted']} strokeWidth={2} />}
                    </TouchableOpacity>
                  )}
                </View>
                <View
                  className="mt-3 rounded-full overflow-hidden"
                  style={{ borderCurve: 'continuous', height: 6, backgroundColor: colors['surface-raised'] }}
                >
                  <View
                    className="rounded-full"
                    style={{
                      borderCurve: 'continuous',
                      width: `${pct}%`,
                      height: '100%',
                      backgroundColor: row.is_me ? colors.accent : colors['text-muted'],
                    }}
                  />
                </View>
              </View>
            )
          })}
        </View>
      )}

      {pickerOpen && (
        <ExercisePickerSheet
          onClose={() => setPickerOpen(false)}
          onPick={(key) => { setExercise(key); setPickerOpen(false) }}
          onClear={() => { setExercise(null); setPickerOpen(false) }}
        />
      )}

      {sheetFor && (
        <SusVouchSheet
          target={sheetFor}
          onClose={() => setSheetFor(null)}
        />
      )}
    </ScrollView>
  )
}

// ─── Friends tab ─────────────────────────────────────────────────────────────

function FriendsTab() {
  const qc = useQueryClient()
  const myUsername = useAuthStore((s) => s.user?.username ?? null)
  const [inviteUsername, setInviteUsername] = useState('')

  const { data, isLoading, refetch, isRefetching } = useQuery<FriendsList>({
    queryKey: ['friends-list'],
    queryFn: () => api.get('/friends').then(r => r.data),
  })

  const invitesQuery = useQuery<InvitesResponse>({
    queryKey: ['invite-links'],
    queryFn: () => api.get('/friends/invites').then(r => r.data),
  })

  // Generate + immediately open the native Share sheet. The list refetch is
  // fire-and-forget; we don't block the share sheet on it.
  const createInviteMutation = useMutation({
    mutationFn: () => api.post('/friends/invites').then(r => r.data as InviteLink),
    onSuccess: async (invite) => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['invite-links'] })
      try {
        await Share.share({
          url: invite.deep_link,
          message: `Join me on GainRace: ${invite.deep_link}`,
        })
      } catch {
        // User dismissed the share sheet — link is still created, fine.
      }
    },
    onError: (err: any) => {
      Alert.alert('Could not generate link', err.response?.data?.detail ?? 'Try again')
    },
  })

  const revokeInviteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/friends/invites/${id}`),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['invite-links'] })
    },
  })

  async function reshareInvite(link: InviteLink) {
    try {
      await Share.share({
        url: link.deep_link,
        message: `Join me on GainRace: ${link.deep_link}`,
      })
    } catch {}
  }

  function confirmRevoke(link: InviteLink) {
    const joined = link.joined_count
    Alert.alert(
      'Revoke invite link?',
      `${link.token} will stop working.${joined > 0 ? ` Friends who already joined will stay.` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revoke', style: 'destructive', onPress: () => revokeInviteMutation.mutate(link.id) },
      ],
    )
  }

  const invites = invitesQuery.data?.invites ?? []
  const cap = invitesQuery.data?.cap ?? 20
  const atCap = invites.length >= cap

  const inviteMutation = useMutation({
    mutationFn: (username: string) => api.post('/friends/invite', { username }),
    onSuccess: () => {
      hapticSuccess()
      setInviteUsername('')
      qc.invalidateQueries({ queryKey: ['friends-list'] })
    },
    onError: (err: any) => {
      if (handleLimitError(err)) return
      Alert.alert('Invite failed', extractErrorMessage(err, 'Try again'))
    },
  })

  const acceptMutation = useMutation({
    mutationFn: (id: string) => api.post(`/friends/accept/${id}`),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['friends-list'] })
      qc.invalidateQueries({ queryKey: ['friends-leaderboard'] })
      qc.invalidateQueries({ queryKey: PLAN_KEY })
    },
    onError: (err: any) => {
      if (handleLimitError(err)) return
      Alert.alert("Couldn't accept", extractErrorMessage(err, 'Try again'))
    },
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/friends/reject/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends-list'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/friends/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends-list'] })
      qc.invalidateQueries({ queryKey: ['friends-leaderboard'] })
    },
  })

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="p-4 pb-8"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.text} />}
      keyboardShouldPersistTaps="handled"
    >
      {/* Invite link — primary CTA. Generates a token server-side and pops
          the native Share sheet immediately, so the common flow is one tap. */}
      <Text className="text-text-subtle text-caption mb-2">Invite link</Text>
      <PressableScale
        haptic
        onPress={() => createInviteMutation.mutate()}
        disabled={atCap || createInviteMutation.isPending}
        className="bg-accent rounded-md py-3 mb-2 items-center"
        style={{ borderCurve: 'continuous', opacity: atCap || createInviteMutation.isPending ? 0.4 : 1 }}
      >
        {createInviteMutation.isPending
          ? <ActivityIndicator color={colors['on-accent']} />
          : <Text className="text-on-accent text-footnote font-semibold">Share invite link</Text>}
      </PressableScale>
      {atCap && (
        <Text className="text-text-subtle text-caption mb-2">
          You have {cap} active links — revoke one to share a new one.
        </Text>
      )}
      {invites.length > 0 && (
        <View className="bg-surface border border-divider rounded-xl overflow-hidden mb-5" style={{ borderCurve: 'continuous' }}>
          {invites.map((link, i) => (
            <View
              key={link.id}
              className="flex-row items-center justify-between px-4 py-3"
              style={{
                borderBottomWidth: i === invites.length - 1 ? 0 : 1,
                borderBottomColor: colors.divider,
              }}
            >
              <View className="flex-1">
                <Text className="text-text text-footnote font-semibold" style={{ letterSpacing: 1.5 }}>
                  {link.token}
                </Text>
                <Text className="text-text-subtle text-caption mt-1">
                  {link.joined_count} joined · expires in {daysUntil(link.expires_at)}d
                </Text>
              </View>
              <TouchableOpacity onPress={() => reshareInvite(link)} hitSlop={12} className="px-4 py-2 mr-1 rounded-md bg-surface-raised" style={{ borderCurve: 'continuous' }}>
                <Text className="text-text text-footnote font-medium">Share</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmRevoke(link)} hitSlop={12} className="w-9 h-9 rounded-full items-center justify-center" style={{ borderCurve: 'continuous' }}>
                <MoreHorizontal size={20} color={colors.text} strokeWidth={2.25} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      {invites.length === 0 && (
        <View className="mb-5" />
      )}

      {/* Invite */}
      <Text className="text-text-subtle text-caption mb-2">Invite by username</Text>
      <View className="flex-row gap-2 mb-2">
        <View className="flex-1 flex-row items-center bg-surface-raised border border-border rounded-md px-4" style={{ borderCurve: 'continuous' }}>
          <Text className="text-text-subtle text-footnote">@</Text>
          <TextInput
            value={inviteUsername}
            onChangeText={(v) => setInviteUsername(v.replace(/^@/, '').toLowerCase())}
            placeholder="friend_handle"
            placeholderTextColor={colors['text-subtle']}
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 py-3 text-text text-footnote ml-1"
          />
        </View>
        <PressableScale
          haptic
          onPress={() => {
            const handle = inviteUsername.trim().replace(/^@/, '').toLowerCase()
            if (!handle) return
            inviteMutation.mutate(handle)
          }}
          className="bg-accent rounded-md px-4 justify-center"
          style={{ borderCurve: 'continuous', opacity: inviteUsername.trim() && !inviteMutation.isPending ? 1 : 0.4 }}
        >
          {inviteMutation.isPending
            ? <ActivityIndicator color={colors['on-accent']} />
            : <Text className="text-on-accent text-footnote font-semibold">Send</Text>}
        </PressableScale>
      </View>
      <Text className="text-text-subtle text-caption mb-5">
        Your handle: <Text className="text-text-muted">@{myUsername ?? '—'}</Text>
      </Text>

      {isLoading ? (
        <View className="gap-2">
          <SkeletonCard height={56} />
          <SkeletonCard height={56} />
        </View>
      ) : (
        <>
          {/* Pending in */}
          {(data?.pending_in?.length ?? 0) > 0 && (
            <>
              <Text className="text-text-subtle text-caption mb-2">Requests</Text>
              <View className="bg-surface border border-divider rounded-xl overflow-hidden mb-5" style={{ borderCurve: 'continuous' }}>
                {data!.pending_in.map((r, i) => (
                  <View
                    key={r.id}
                    className="flex-row items-center justify-between px-4 py-3"
                    style={{
                      borderBottomWidth: i === data!.pending_in.length - 1 ? 0 : 1,
                      borderBottomColor: colors.divider,
                    }}
                  >
                    <View className="flex-1">
                      <Text className="text-text text-footnote font-medium">{r.user.name}</Text>
                      <Text className="text-text-subtle text-caption">
                        {r.user.username ? `@${r.user.username}` : r.user.name}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => acceptMutation.mutate(r.id)}
                      className="bg-accent rounded-md px-4 py-2 mr-2" style={{ borderCurve: 'continuous' }}
                    >
                      <Text className="text-on-accent text-footnote font-semibold">Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => rejectMutation.mutate(r.id)}
                      hitSlop={12}
                      className="w-9 h-9 rounded-full bg-surface-raised items-center justify-center" style={{ borderCurve: 'continuous' }}
                    >
                      <X size={18} color={colors.text} strokeWidth={2.25} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Friends */}
          <Text className="text-text-subtle text-caption mb-2">
            Friends ({data?.friends.length ?? 0})
          </Text>
          {data?.friends.length === 0 ? (
            <View className="bg-surface border border-divider rounded-xl p-6 items-center mb-5" style={{ borderCurve: 'continuous' }}>
              <Text className="text-text-muted text-footnote font-medium">No friends yet</Text>
              <Text className="text-text-subtle text-caption mt-1 text-center">
                Send an invite above. They need to have a GainRace account.
              </Text>
            </View>
          ) : (
            <View className="bg-surface border border-divider rounded-xl overflow-hidden mb-5" style={{ borderCurve: 'continuous' }}>
              {data!.friends.map((r, i) => (
                <View
                  key={r.id}
                  className="flex-row items-center justify-between px-4 py-3"
                  style={{
                    borderBottomWidth: i === data!.friends.length - 1 ? 0 : 1,
                    borderBottomColor: colors.divider,
                  }}
                >
                  <View className="flex-1">
                    <Text className="text-text text-footnote font-medium">{r.user.name}</Text>
                    <Text className="text-text-subtle text-caption">
                      {r.user.username ? `@${r.user.username}` : r.user.name}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => Alert.alert(
                      'Remove friend?',
                      `Unfriend ${r.user.name}? They'll be removed from your leaderboard.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Remove', style: 'destructive', onPress: () => deleteMutation.mutate(r.id) },
                      ],
                    )}
                    hitSlop={12}
                    className="w-9 h-9 rounded-full items-center justify-center" style={{ borderCurve: 'continuous' }}
                  >
                    <MoreHorizontal size={20} color={colors.text} strokeWidth={2.25} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Pending out */}
          {(data?.pending_out?.length ?? 0) > 0 && (
            <>
              <Text className="text-text-subtle text-caption mb-2">Sent</Text>
              <View className="bg-surface border border-divider rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
                {data!.pending_out.map((r, i) => (
                  <View
                    key={r.id}
                    className="flex-row items-center justify-between px-4 py-3"
                    style={{
                      borderBottomWidth: i === data!.pending_out.length - 1 ? 0 : 1,
                      borderBottomColor: colors.divider,
                    }}
                  >
                    <View className="flex-1">
                      <Text className="text-text text-footnote font-medium">{r.user.name}</Text>
                      <Text className="text-text-subtle text-caption">
                        {r.user.username ? `@${r.user.username}` : r.user.name}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => deleteMutation.mutate(r.id)}
                      hitSlop={12}
                      className="px-3 py-2 rounded-md bg-surface-raised" style={{ borderCurve: 'continuous' }}
                    >
                      <Text className="text-text text-footnote font-medium">Cancel</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  )
}

// ─── Exercise picker sheet ───────────────────────────────────────────────────

function ExercisePickerSheet({
  onPick,
  onClear,
  onClose,
}: {
  onPick: (key: string) => void
  onClear: () => void
  onClose: () => void
}) {
  return (
    <View
      className="absolute inset-0 bg-bg/60 justify-end"
      onTouchEnd={onClose}
    >
      <View
        className="bg-surface rounded-t-xl pt-2 pb-6 max-h-[80%]" style={{ borderCurve: 'continuous' }}
        onStartShouldSetResponder={() => true}
      >
        <View className="items-center pt-2 pb-2">
          <View className="w-10 h-1 bg-border rounded-full" style={{ borderCurve: 'continuous' }} />
        </View>
        <View className="flex-row items-center justify-between px-4 py-2 border-b border-divider">
          <Text className="text-text font-semibold">Filter by exercise</Text>
          <TouchableOpacity onPress={onClear}>
            <Text className="text-text-muted text-footnote">All</Text>
          </TouchableOpacity>
        </View>
        <ScrollView className="px-4 pt-3" contentContainerClassName="pb-4">
          <View className="gap-2">
            {EXERCISES.map(e => (
              <TouchableOpacity
                key={e.key}
                onPress={() => { hapticSelection(); onPick(e.key) }}
                className="px-4 py-3 rounded-xl bg-surface-raised border border-border" style={{ borderCurve: 'continuous' }}
              >
                <Text className="text-text text-footnote">{e.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  )
}

// ─── Screen ──────────────────────────────────────────────────────────────────

type Tab = 'leaderboard' | 'friends'

export default function FriendsScreen() {
  const { user } = useRequireAuth()
  const [tab, setTab] = useState<Tab>('leaderboard')

  if (!user) return null

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="-ml-1 px-2 py-2 flex-row items-center gap-1">
          <ChevronLeft size={22} color={colors.text} strokeWidth={2.25} />
          <Text className="text-text-muted text-body font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-text text-headline font-semibold">Friends</Text>
        <View style={{ width: 70 }} />
      </View>

      {/* Tabs */}
      <View className="flex-row mx-4 mt-1 p-1 bg-surface border border-divider rounded-full" style={{ borderCurve: 'continuous' }}>
        {(['leaderboard', 'friends'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            onPress={() => { hapticLight(); setTab(t) }}
            className="flex-1 py-3 rounded-full items-center"
            style={{ borderCurve: 'continuous', backgroundColor: tab === t ? colors.text : 'transparent' }}
          >
            <Text
              className="text-footnote font-semibold capitalize"
              style={{ color: tab === t ? colors.bg : colors['text-muted'] }}
            >
              {t}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'leaderboard' && <LeaderboardTab />}
      {tab === 'friends'     && <FriendsTab />}
    </SafeAreaView>
  )
}
