import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { SkeletonCard } from '../components/Skeleton'
import { PressableScale } from '../components/PressableScale'
import { hapticSuccess, hapticLight, hapticSelection } from '../lib/haptics'

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
  email: string
  weight_kg: number | null
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
  days_trained: number
  sus_votes: number
  sus_threshold: number
  is_sus: boolean
  is_me: boolean
  rank: number
}

interface LeaderboardResponse {
  week_start: string
  week_end: string
  exercise: string | null
  sus_threshold: number
  rows: LeaderboardRow[]
}

interface Recap {
  week_start: string
  week_end: string
  circle_size: number
  headlines: {
    top_volume?: { user: FriendUser; total_volume_kg: number } | null
    most_consistent?: { user: FriendUser; days_trained: number } | null
    most_pr?: { user: FriendUser; pr_count: number } | null
    most_sus?: { user: FriendUser; votes: number; threshold: number } | null
  }
  me: LeaderboardRow | null
}

// ─── Leaderboard tab ─────────────────────────────────────────────────────────

function LeaderboardTab() {
  const qc = useQueryClient()
  const [exercise, setExercise] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const path = exercise
    ? `/friends/leaderboard?exercise=${encodeURIComponent(exercise)}`
    : '/friends/leaderboard'

  const { data, isLoading, refetch, isRefetching } = useQuery<LeaderboardResponse>({
    queryKey: ['friends-leaderboard', exercise],
    queryFn: () => api.get(path).then(r => r.data),
  })

  const voteMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/friends/vote-sus/${userId}`),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['friends-leaderboard'] })
      qc.invalidateQueries({ queryKey: ['friends-recap'] })
    },
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
      <View className="mb-3 flex-row items-center gap-2">
        <Text className="text-zinc-500 text-xs uppercase tracking-widest flex-1">
          {exercise ? `By Exercise` : `Total Weekly Volume`}
        </Text>
        <TouchableOpacity
          onPress={() => setPickerOpen(true)}
          className="flex-row items-center gap-1 px-3 py-1 rounded-full border border-zinc-700"
        >
          <Text className="text-white text-xs font-medium">
            {exercise ? EXERCISE_NAME[exercise] : 'All exercises'}
          </Text>
          <Text className="text-zinc-500 text-xs">▾</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={{ gap: 8 }}>
          <SkeletonCard height={64} />
          <SkeletonCard height={64} />
          <SkeletonCard height={64} />
        </View>
      ) : rows.length === 0 ? (
        <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 items-center">
          <Text className="text-zinc-400 text-sm font-medium">No data yet</Text>
          <Text className="text-zinc-600 text-xs mt-1 text-center">
            Add friends and log workouts to see the leaderboard
          </Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {rows.map(row => {
            const pct = (row.total_volume_kg / maxVol) * 100
            const medal = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : null
            return (
              <View
                key={row.user.id}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3"
                style={row.is_me ? { borderColor: '#52525b' } : undefined}
              >
                <View className="flex-row items-center gap-3">
                  <View className="w-7 items-center">
                    {medal
                      ? <Text style={{ fontSize: 16 }}>{medal}</Text>
                      : <Text className="text-zinc-500 text-sm">{row.rank}</Text>}
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2 flex-wrap">
                      <Text className="text-white text-sm font-semibold">
                        {row.user.name}{row.is_me ? ' (you)' : ''}
                      </Text>
                      {row.sus_votes > 0 && (
                        <View
                          className="px-1.5 py-0.5 rounded-full"
                          style={{
                            backgroundColor: row.is_sus ? 'rgba(120,53,15,0.4)' : '#27272a',
                            borderWidth: 1,
                            borderColor: row.is_sus ? 'rgba(180,83,9,0.4)' : '#3f3f46',
                          }}
                        >
                          <Text
                            className="text-xs"
                            style={{ color: row.is_sus ? '#fbbf24' : '#a1a1aa' }}
                          >
                            🤨 {row.sus_votes} / {row.sus_threshold}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-zinc-500 text-xs mt-0.5">
                      {row.days_trained} day{row.days_trained === 1 ? '' : 's'} this week
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-white text-sm font-bold">
                      {row.total_volume_kg.toLocaleString()}
                    </Text>
                    <Text className="text-zinc-500 text-xs">kg</Text>
                  </View>
                  {!row.is_me && (
                    <TouchableOpacity
                      onPress={() => {
                        Alert.alert(
                          'Vote sus?',
                          `Flag ${row.user.name}'s logs as suspicious this week. ${row.sus_threshold}+ votes light up the 🤨 badge. Resets Monday.`,
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Vote', onPress: () => voteMutation.mutate(row.user.id) },
                          ],
                        )
                      }}
                      hitSlop={8}
                      className="ml-1 px-2"
                    >
                      <Text className="text-zinc-600 text-base">🤨</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View
                  className="mt-2 rounded-full overflow-hidden"
                  style={{ height: 4, backgroundColor: '#27272a' }}
                >
                  <View
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      backgroundColor: row.is_me ? '#ffffff' : '#71717a',
                      borderRadius: 2,
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
                        {r.user.username ? `@${r.user.username}` : r.user.email}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => acceptMutation.mutate(r.id)}
                      className="bg-white rounded-full px-3 py-1.5 mr-2"
                    >
                      <Text className="text-black text-xs font-semibold">Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => rejectMutation.mutate(r.id)}
                      hitSlop={8}
                    >
                      <Text className="text-zinc-500 text-sm">✕</Text>
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
                Send an invite above. They need to have a Protocol account.
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
                      {r.user.username ? `@${r.user.username}` : r.user.email}
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
                    hitSlop={8}
                    className="px-2"
                  >
                    <Text className="text-zinc-500 text-base">⋯</Text>
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
                        {r.user.username ? `@${r.user.username}` : r.user.email}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => deleteMutation.mutate(r.id)}
                      hitSlop={8}
                    >
                      <Text className="text-zinc-500 text-xs">Cancel</Text>
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

// ─── Recap tab ───────────────────────────────────────────────────────────────

function RecapTab() {
  const { data, isLoading, refetch, isRefetching } = useQuery<Recap>({
    queryKey: ['friends-recap'],
    queryFn: () => api.get('/friends/recap').then(r => r.data),
  })

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#ffffff" />}
    >
      {isLoading ? (
        <View style={{ gap: 12 }}>
          <SkeletonCard height={92} />
          <SkeletonCard height={92} />
        </View>
      ) : !data || data.circle_size === 0 ? (
        <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 items-center">
          <Text className="text-zinc-400 text-sm font-medium">Nothing to recap yet</Text>
          <Text className="text-zinc-600 text-xs mt-1 text-center">
            Add friends and log a few workouts. Recap refreshes Monday.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Text className="text-zinc-500 text-xs uppercase tracking-widest">
            Week of {data.week_start}
          </Text>

          {data.headlines.top_volume && (
            <Headline
              icon="🏋️"
              label="Most volume"
              user={data.headlines.top_volume.user}
              value={`${data.headlines.top_volume.total_volume_kg.toLocaleString()} kg`}
            />
          )}
          {data.headlines.most_consistent && (
            <Headline
              icon="📅"
              label="Most consistent"
              user={data.headlines.most_consistent.user}
              value={`${data.headlines.most_consistent.days_trained} days`}
            />
          )}
          {data.headlines.most_pr && (
            <Headline
              icon="📈"
              label="Most PRs"
              user={data.headlines.most_pr.user}
              value={`${data.headlines.most_pr.pr_count} PR${data.headlines.most_pr.pr_count === 1 ? '' : 's'}`}
            />
          )}
          {data.headlines.most_sus && (
            <Headline
              icon="🤨"
              label="Most sus"
              user={data.headlines.most_sus.user}
              value={`${data.headlines.most_sus.votes} / ${data.headlines.most_sus.threshold}`}
            />
          )}

          {data.me && (
            <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mt-2">
              <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">Your week</Text>
              <View className="flex-row items-baseline gap-3 flex-wrap">
                <Text className="text-white text-2xl font-bold">{data.me.total_volume_kg.toLocaleString()}</Text>
                <Text className="text-zinc-500 text-sm">kg moved</Text>
                <Text className="text-zinc-500 text-sm">·</Text>
                <Text className="text-zinc-300 text-sm">Rank #{data.me.rank} of {data.circle_size}</Text>
                <Text className="text-zinc-500 text-sm">·</Text>
                <Text className="text-zinc-300 text-sm">{data.me.days_trained} days trained</Text>
              </View>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  )
}

function Headline({
  icon,
  label,
  user,
  value,
}: {
  icon: string
  label: string
  user: FriendUser
  value: string
}) {
  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex-row items-center gap-3">
      <Text style={{ fontSize: 24 }}>{icon}</Text>
      <View className="flex-1">
        <Text className="text-zinc-500 text-xs uppercase tracking-widest">{label}</Text>
        <Text className="text-white text-sm font-semibold mt-0.5">{user.name}</Text>
      </View>
      <Text className="text-white text-base font-bold">{value}</Text>
    </View>
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

type Tab = 'leaderboard' | 'friends' | 'recap'

export default function FriendsScreen() {
  const { user } = useRequireAuth()
  const [tab, setTab] = useState<Tab>('leaderboard')

  if (!user) return null

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Text className="text-zinc-400 text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-base font-semibold">Friends</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Tabs */}
      <View className="flex-row mx-4 mt-1 p-1 bg-zinc-900 border border-zinc-800 rounded-2xl">
        {(['leaderboard', 'friends', 'recap'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            onPress={() => { hapticLight(); setTab(t) }}
            className="flex-1 py-2 rounded-xl items-center"
            style={{ backgroundColor: tab === t ? '#27272a' : 'transparent' }}
          >
            <Text
              className="text-xs font-medium capitalize"
              style={{ color: tab === t ? 'white' : '#71717a' }}
            >
              {t}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'leaderboard' && <LeaderboardTab />}
      {tab === 'friends'     && <FriendsTab />}
      {tab === 'recap'       && <RecapTab />}
    </SafeAreaView>
  )
}
