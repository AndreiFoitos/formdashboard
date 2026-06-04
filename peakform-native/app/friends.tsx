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
import { useAuthStore } from '../store/auth'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { SkeletonCard } from '../components/Skeleton'
import { PressableScale } from '../components/PressableScale'
import { hapticSuccess, hapticLight, hapticSelection } from '../lib/haptics'
import { TrustedShield } from '../components/icons/TrustedShield'
import { SusFace } from '../components/icons/SusFace'

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
      <View className="flex-1 bg-zinc-950">
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 bg-zinc-700 rounded-full" />
        </View>
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-800">
          <View>
            <Text className="text-white font-semibold">{target.user.name}</Text>
            <Text className="text-zinc-500 text-xs mt-0.5">
              {target.total_volume_kg.toLocaleString()} kg this week
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            className="w-10 h-10 -mr-1 rounded-full bg-zinc-900 border border-zinc-800 items-center justify-center"
          >
            <X size={20} color="#e4e4e7" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>

        <ScrollView
          className="flex-1 px-4 pt-4"
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Scope toggle */}
          <View className="flex-row bg-zinc-900 border border-zinc-800 rounded-2xl p-1 mb-4">
            {(['weekly', 'per_lift'] as const).map((m) => {
              const active = mode === m
              return (
                <TouchableOpacity
                  key={m}
                  onPress={() => {
                    hapticSelection()
                    setMode(m)
                  }}
                  className="flex-1 py-2 items-center rounded-xl"
                  style={{ backgroundColor: active ? '#27272a' : 'transparent' }}
                >
                  <Text
                    className="text-xs font-medium"
                    style={{ color: active ? 'white' : '#71717a' }}
                  >
                    {m === 'weekly' ? 'Whole week' : 'A specific lift'}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* Weekly scope — two big action buttons. */}
          {mode === 'weekly' && (
            <View style={{ gap: 10 }}>
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
              <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
                Last 7 days
              </Text>
              {liftsQuery.isLoading ? (
                <ActivityIndicator color="#71717a" />
              ) : (liftsQuery.data?.lifts.length ?? 0) === 0 ? (
                <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 items-center">
                  <Text className="text-zinc-500 text-xs">No lifts in the last 7 days</Text>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
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
  const bg = active ? (isApprove ? '#052e16' : 'rgba(120,53,15,0.4)') : '#18181b'
  const border = active ? (isApprove ? '#14532d' : 'rgba(180,83,9,0.4)') : '#3f3f46'
  const fg = active ? (isApprove ? '#86efac' : '#fbbf24') : 'white'
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      className="rounded-2xl px-4 py-4 flex-row items-center justify-between"
      style={{ backgroundColor: bg, borderWidth: 1, borderColor: border }}
    >
      <View className="flex-1 pr-3">
        <View className="flex-row items-center" style={{ gap: 6 }}>
          {isApprove ? <TrustedShield size={14} /> : <SusFace size={14} />}
          <Text className="text-sm font-semibold" style={{ color: fg }}>
            {label}
          </Text>
        </View>
        <Text className="text-zinc-500 text-xs mt-0.5">{sub}</Text>
      </View>
      {busy && <ActivityIndicator color="#a1a1aa" />}
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
  return (
    <View className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4 py-3 flex-row items-center">
      <View className="flex-1 pr-2">
        <Text className="text-white text-sm font-semibold">
          {EXERCISE_NAME[lift.type] ?? lift.type}
        </Text>
        <Text className="text-zinc-500 text-xs mt-0.5">
          {new Date(lift.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          {' · '}
          {lift.weight_kg ?? '–'}kg × {lift.reps ?? '–'}
        </Text>
      </View>
      <View className="flex-row" style={{ gap: 6 }}>
        <PillButton
          active={lift.already_vouched}
          kind="trusted"
          tintActive="#14532d"
          fgActive="#86efac"
          onPress={onApprove}
          disabled={busy}
        />
        <PillButton
          active={lift.already_sus}
          kind="sus"
          tintActive="rgba(180,83,9,0.5)"
          fgActive="#fbbf24"
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
      className="px-3 py-1.5 rounded-full"
      style={{
        backgroundColor: active ? tintActive : '#27272a',
        borderWidth: 1,
        borderColor: active ? fgActive : '#3f3f46',
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
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#ffffff" />}
    >
      {/* Exercise filter */}
      <View className="mb-4 flex-row items-center gap-2">
        <Text className="text-zinc-400 text-xs uppercase tracking-widest flex-1 font-semibold">
          {exercise ? `By Exercise` : `Total Weekly Volume`}
        </Text>
        <TouchableOpacity
          onPress={() => setPickerOpen(true)}
          hitSlop={8}
          className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-full border border-zinc-700"
        >
          <Text className="text-white text-sm font-medium">
            {exercise ? EXERCISE_NAME[exercise] : 'All exercises'}
          </Text>
          <Text className="text-zinc-400 text-sm">▾</Text>
        </TouchableOpacity>
      </View>


      {isLoading ? (
        <View style={{ gap: 10 }}>
          <SkeletonCard height={88} />
          <SkeletonCard height={88} />
          <SkeletonCard height={88} />
        </View>
      ) : rows.length === 0 ? (
        <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 items-center">
          <Text className="text-zinc-300 text-base font-medium">No data yet</Text>
          <Text className="text-zinc-500 text-sm mt-1 text-center">
            Add friends and log workouts to see the leaderboard
          </Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {rows.map(row => {
            const pct = (row.total_volume_kg / maxVol) * 100
            const medal = row.rank === 1 ? { Icon: Trophy, color: '#FCD34D' }
                        : row.rank === 2 ? { Icon: Award,  color: '#D1D5DB' }
                        : row.rank === 3 ? { Icon: Award,  color: '#B45309' }
                        : null
            return (
              <View
                key={row.user.id}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4"
                style={row.is_me ? { borderColor: '#71717a', borderWidth: 1.5 } : undefined}
              >
                <View className="flex-row items-center" style={{ gap: 14 }}>
                  <View className="w-9 items-center">
                    {medal
                      ? <medal.Icon size={26} color={medal.color} strokeWidth={2} />
                      : <Text className="text-zinc-400 text-lg font-semibold">{row.rank}</Text>}
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2 flex-wrap">
                      <Text className="text-white text-base font-semibold">
                        {row.user.name}{row.is_me ? ' (you)' : ''}
                      </Text>
                      {row.is_trusted && (
                        <View
                          className="px-2 py-0.5 rounded-full flex-row items-center"
                          style={{
                            backgroundColor: 'rgba(20,83,45,0.4)',
                            borderWidth: 1,
                            borderColor: 'rgba(34,197,94,0.4)',
                            gap: 4,
                          }}
                        >
                          <TrustedShield size={14} />
                          <Text className="text-xs font-semibold" style={{ color: '#86efac' }}>
                            {row.vouches}
                          </Text>
                        </View>
                      )}
                      {(row.sus_score > 0 || row.is_sus) && (
                        <View
                          className="px-2 py-0.5 rounded-full flex-row items-center"
                          style={{
                            backgroundColor: row.is_sus ? 'rgba(120,53,15,0.4)' : '#27272a',
                            borderWidth: 1,
                            borderColor: row.is_sus ? 'rgba(180,83,9,0.4)' : '#3f3f46',
                            gap: 4,
                          }}
                        >
                          <SusFace size={14} />
                          <Text
                            className="text-xs font-semibold"
                            style={{ color: row.is_sus ? '#fbbf24' : '#a1a1aa' }}
                          >
                            {row.sus_score} / {row.sus_threshold}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-zinc-500 text-sm mt-1">
                      {row.days_trained} day{row.days_trained === 1 ? '' : 's'} this week
                      {row.sus_per_lift_votes > 0 && ` · ${row.sus_per_lift_votes} lift${row.sus_per_lift_votes === 1 ? '' : 's'} sus'd`}
                    </Text>
                  </View>
                  <View className="items-end" style={{ minWidth: 88 }}>
                    <Text className="text-white text-lg font-bold">
                      {row.total_volume_kg.toLocaleString()}
                      <Text className="text-zinc-500 text-xs font-normal"> kg</Text>
                    </Text>
                    <Text className="text-zinc-400 text-sm font-semibold mt-0.5">
                      {row.dots_volume != null ? row.dots_volume.toLocaleString() : '—'}
                      <Text className="text-zinc-600 text-xs font-normal"> DOTS</Text>
                    </Text>
                  </View>
                  {!row.is_me && (
                    <TouchableOpacity
                      onPress={() => { hapticLight(); setSheetFor(row) }}
                      hitSlop={12}
                      className="ml-1 w-10 h-10 rounded-full items-center justify-center"
                      style={{ backgroundColor: '#18181b', borderWidth: 1, borderColor: '#3f3f46' }}
                    >
                      {row.i_vouched
                        ? <TrustedShield size={22} />
                        : row.i_sus_weekly
                          ? <SusFace size={22} />
                          : <HelpCircle size={22} color="#a1a1aa" strokeWidth={2} />}
                    </TouchableOpacity>
                  )}
                </View>
                <View
                  className="mt-3 rounded-full overflow-hidden"
                  style={{ height: 6, backgroundColor: '#27272a' }}
                >
                  <View
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      backgroundColor: row.is_me ? '#ffffff' : '#a1a1aa',
                      borderRadius: 3,
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
          message: `Join me on PeakForm: ${invite.deep_link}`,
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
        message: `Join me on PeakForm: ${link.deep_link}`,
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
      Alert.alert('Invite failed', err.response?.data?.detail ?? 'Try again')
    },
  })

  const acceptMutation = useMutation({
    mutationFn: (id: string) => api.post(`/friends/accept/${id}`),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['friends-list'] })
      qc.invalidateQueries({ queryKey: ['friends-leaderboard'] })
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
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#ffffff" />}
      keyboardShouldPersistTaps="handled"
    >
      {/* Invite link — primary CTA. Generates a token server-side and pops
          the native Share sheet immediately, so the common flow is one tap. */}
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Invite link</Text>
      <PressableScale
        haptic
        onPress={() => createInviteMutation.mutate()}
        disabled={atCap || createInviteMutation.isPending}
        className="bg-white rounded-2xl py-3 mb-2 items-center"
        style={{ opacity: atCap || createInviteMutation.isPending ? 0.4 : 1 }}
      >
        {createInviteMutation.isPending
          ? <ActivityIndicator color="black" />
          : <Text className="text-black text-sm font-semibold">Share invite link</Text>}
      </PressableScale>
      {atCap && (
        <Text className="text-zinc-600 text-xs mb-2">
          You have {cap} active links — revoke one to share a new one.
        </Text>
      )}
      {invites.length > 0 && (
        <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden mb-5">
          {invites.map((link, i) => (
            <View
              key={link.id}
              className="flex-row items-center justify-between px-4 py-3"
              style={{
                borderBottomWidth: i === invites.length - 1 ? 0 : 1,
                borderBottomColor: '#27272a',
              }}
            >
              <View className="flex-1">
                <Text className="text-white text-sm font-semibold" style={{ letterSpacing: 1.5 }}>
                  {link.token}
                </Text>
                <Text className="text-zinc-500 text-xs mt-0.5">
                  {link.joined_count} joined · expires in {daysUntil(link.expires_at)}d
                </Text>
              </View>
              <TouchableOpacity onPress={() => reshareInvite(link)} hitSlop={12} className="px-4 py-2 mr-1 rounded-full bg-zinc-800">
                <Text className="text-zinc-100 text-sm font-medium">Share</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmRevoke(link)} hitSlop={12} className="w-9 h-9 rounded-full items-center justify-center">
                <MoreHorizontal size={20} color="#d4d4d8" strokeWidth={2.25} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      {invites.length === 0 && (
        <View className="mb-5" />
      )}

      {/* Invite */}
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Invite by username</Text>
      <View className="flex-row gap-2 mb-2">
        <View className="flex-1 flex-row items-center bg-zinc-900 border border-zinc-800 rounded-2xl px-4">
          <Text className="text-zinc-500 text-sm">@</Text>
          <TextInput
            value={inviteUsername}
            onChangeText={(v) => setInviteUsername(v.replace(/^@/, '').toLowerCase())}
            placeholder="friend_handle"
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 py-3 text-white text-sm ml-1"
          />
        </View>
        <PressableScale
          haptic
          onPress={() => {
            const handle = inviteUsername.trim().replace(/^@/, '').toLowerCase()
            if (!handle) return
            inviteMutation.mutate(handle)
          }}
          className="bg-white rounded-2xl px-4 justify-center"
          style={{ opacity: inviteUsername.trim() && !inviteMutation.isPending ? 1 : 0.4 }}
        >
          {inviteMutation.isPending
            ? <ActivityIndicator color="black" />
            : <Text className="text-black text-sm font-semibold">Send</Text>}
        </PressableScale>
      </View>
      <Text className="text-zinc-600 text-xs mb-5">
        Your handle: <Text className="text-zinc-400">@{myUsername ?? '—'}</Text>
      </Text>

      {isLoading ? (
        <View style={{ gap: 8 }}>
          <SkeletonCard height={56} />
          <SkeletonCard height={56} />
        </View>
      ) : (
        <>
          {/* Pending in */}
          {(data?.pending_in?.length ?? 0) > 0 && (
            <>
              <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Requests</Text>
              <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden mb-5">
                {data!.pending_in.map((r, i) => (
                  <View
                    key={r.id}
                    className="flex-row items-center justify-between px-4 py-3"
                    style={{
                      borderBottomWidth: i === data!.pending_in.length - 1 ? 0 : 1,
                      borderBottomColor: '#27272a',
                    }}
                  >
                    <View className="flex-1">
                      <Text className="text-white text-sm font-medium">{r.user.name}</Text>
                      <Text className="text-zinc-500 text-xs">
                        {r.user.username ? `@${r.user.username}` : r.user.name}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => acceptMutation.mutate(r.id)}
                      className="bg-white rounded-full px-4 py-2 mr-2"
                    >
                      <Text className="text-black text-sm font-semibold">Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => rejectMutation.mutate(r.id)}
                      hitSlop={12}
                      className="w-9 h-9 rounded-full bg-zinc-800 items-center justify-center"
                    >
                      <X size={18} color="#d4d4d8" strokeWidth={2.25} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Friends */}
          <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
            Friends ({data?.friends.length ?? 0})
          </Text>
          {data?.friends.length === 0 ? (
            <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 items-center mb-5">
              <Text className="text-zinc-400 text-sm font-medium">No friends yet</Text>
              <Text className="text-zinc-600 text-xs mt-1 text-center">
                Send an invite above. They need to have a PeakForm account.
              </Text>
            </View>
          ) : (
            <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden mb-5">
              {data!.friends.map((r, i) => (
                <View
                  key={r.id}
                  className="flex-row items-center justify-between px-4 py-3"
                  style={{
                    borderBottomWidth: i === data!.friends.length - 1 ? 0 : 1,
                    borderBottomColor: '#27272a',
                  }}
                >
                  <View className="flex-1">
                    <Text className="text-white text-sm font-medium">{r.user.name}</Text>
                    <Text className="text-zinc-500 text-xs">
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
                    className="w-9 h-9 rounded-full items-center justify-center"
                  >
                    <MoreHorizontal size={20} color="#d4d4d8" strokeWidth={2.25} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Pending out */}
          {(data?.pending_out?.length ?? 0) > 0 && (
            <>
              <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Sent</Text>
              <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                {data!.pending_out.map((r, i) => (
                  <View
                    key={r.id}
                    className="flex-row items-center justify-between px-4 py-3"
                    style={{
                      borderBottomWidth: i === data!.pending_out.length - 1 ? 0 : 1,
                      borderBottomColor: '#27272a',
                    }}
                  >
                    <View className="flex-1">
                      <Text className="text-white text-sm font-medium">{r.user.name}</Text>
                      <Text className="text-zinc-500 text-xs">
                        {r.user.username ? `@${r.user.username}` : r.user.name}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => deleteMutation.mutate(r.id)}
                      hitSlop={12}
                      className="px-3 py-2 rounded-full bg-zinc-800"
                    >
                      <Text className="text-zinc-200 text-sm font-medium">Cancel</Text>
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
      className="absolute inset-0 bg-black/60 justify-end"
      onTouchEnd={onClose}
    >
      <View
        className="bg-zinc-950 rounded-t-3xl pt-2 pb-6 max-h-[80%]"
        onStartShouldSetResponder={() => true}
      >
        <View className="items-center pt-2 pb-2">
          <View className="w-10 h-1 bg-zinc-700 rounded-full" />
        </View>
        <View className="flex-row items-center justify-between px-4 py-2 border-b border-zinc-800">
          <Text className="text-white font-semibold">Filter by exercise</Text>
          <TouchableOpacity onPress={onClear}>
            <Text className="text-zinc-400 text-sm">All</Text>
          </TouchableOpacity>
        </View>
        <ScrollView className="px-4 pt-3" contentContainerStyle={{ paddingBottom: 16 }}>
          <View style={{ gap: 6 }}>
            {EXERCISES.map(e => (
              <TouchableOpacity
                key={e.key}
                onPress={() => { hapticSelection(); onPick(e.key) }}
                className="px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800"
              >
                <Text className="text-white text-sm">{e.name}</Text>
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
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="-ml-1 px-2 py-2 flex-row items-center" style={{ gap: 2 }}>
          <ChevronLeft size={22} color="#d4d4d8" strokeWidth={2.25} />
          <Text className="text-zinc-300 text-base font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-lg font-semibold">Friends</Text>
        <View style={{ width: 70 }} />
      </View>

      {/* Tabs */}
      <View className="flex-row mx-4 mt-1 p-1 bg-zinc-900 border border-zinc-800 rounded-2xl">
        {(['leaderboard', 'friends'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            onPress={() => { hapticLight(); setTab(t) }}
            className="flex-1 py-3 rounded-xl items-center"
            style={{ backgroundColor: tab === t ? '#27272a' : 'transparent' }}
          >
            <Text
              className="text-sm font-semibold capitalize"
              style={{ color: tab === t ? 'white' : '#a1a1aa' }}
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
