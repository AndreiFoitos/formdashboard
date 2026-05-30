import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { removeToken } from '../lib/storage'
import {
  fetchConnectedDevices,
  disconnectDevice,
  requestHealthPermissions,
  runHealthKitBackfill,
  isHealthKitPlatform,
  type ConnectedDevice,
} from '../lib/healthkit'
import { connectOura, syncOura } from '../lib/oura'
import { hapticSuccess } from '../lib/haptics'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

// ─── Section wrapper ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-3">{title}</Text>
      <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        {children}
      </View>
    </View>
  )
}

// ─── Profile & targets ─────────────────────────────────────────────────────────

const GOALS = [
  { key: 'bulk', label: 'Bulk' },
  { key: 'cut', label: 'Cut' },
  { key: 'maintain', label: 'Maintain' },
  { key: 'recomp', label: 'Recomp' },
]

function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:00 ${period}`
}

function TargetRow({
  label,
  value,
  onChangeText,
  unit,
  placeholder,
}: {
  label: string
  value: string
  onChangeText: (v: string) => void
  unit: string
  placeholder: string
}) {
  return (
    <View className="flex-row items-center justify-between px-4 py-3.5 border-b border-zinc-800">
      <Text className="text-zinc-300 text-sm">{label}</Text>
      <View className="flex-row items-center">
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#52525b"
          keyboardType="number-pad"
          className="text-white text-sm text-right"
          style={{ minWidth: 64 }}
        />
        <Text className="text-zinc-500 text-xs ml-1">{unit}</Text>
      </View>
    </View>
  )
}

function ProfileSection() {
  const { user, updateUser } = useAuthStore()
  const qc = useQueryClient()

  const [goal, setGoal] = useState<string | null>(user?.goal ?? null)
  const [username, setUsername] = useState(user?.username ?? '')
  const [protein, setProtein] = useState(
    user?.protein_target_g != null ? String(Math.round(user.protein_target_g)) : '',
  )
  const [water, setWater] = useState(
    user?.water_target_ml != null ? String(user.water_target_ml) : '',
  )
  const [calories, setCalories] = useState(
    user?.calorie_target != null ? String(user.calorie_target) : '',
  )
  const [bedtime, setBedtime] = useState<number>(user?.sleep_hour ?? 23)
  const [saved, setSaved] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)

  const usernameValid = /^[a-z0-9_]{3,24}$/.test(username)
  const usernameDirty = username !== (user?.username ?? '')

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.put('/users/me', payload).then((r) => r.data),
    onSuccess: (updated) => {
      updateUser(updated)
      hapticSuccess()
      setUsernameError(null)
      // Targets and bedtime feed the Form Score + caffeine curve — refresh them.
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['friends-list'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail
      // 409 from /users/me only fires for username conflicts right now.
      if (err?.response?.status === 409 || typeof msg === 'string' && msg.toLowerCase().includes('username')) {
        setUsernameError(typeof msg === 'string' ? msg : 'Username already taken')
      } else {
        Alert.alert('Save failed', typeof msg === 'string' ? msg : 'Try again')
      }
    },
  })

  function onSave() {
    if (usernameDirty && !usernameValid) {
      setUsernameError('3–24 chars; lowercase letters, numbers, underscores')
      return
    }
    setUsernameError(null)
    save.mutate({
      goal: goal ?? undefined,
      username: usernameDirty ? username : undefined,
      sleep_hour: bedtime,
      protein_target_g: protein.trim() ? parseFloat(protein) : null,
      water_target_ml: water.trim() ? parseInt(water) : null,
      calorie_target: calories.trim() ? parseInt(calories) : null,
    })
  }

  return (
    <Section title="Profile & Targets">
      {/* Username */}
      <View className="px-4 py-3.5 border-b border-zinc-800">
        <Text className="text-zinc-300 text-sm mb-1">Username</Text>
        <Text className="text-zinc-600 text-xs mb-2">Friends invite you with this handle</Text>
        <View className="flex-row items-center bg-zinc-950 border border-zinc-800 rounded-xl px-3">
          <Text className="text-zinc-500 text-sm">@</Text>
          <TextInput
            value={username}
            onChangeText={(v) => {
              setUsername(v.replace(/^@/, '').toLowerCase())
              setUsernameError(null)
            }}
            placeholder="your_handle"
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={24}
            className="flex-1 py-2.5 text-white text-sm ml-1"
          />
        </View>
        {usernameError && (
          <Text className="text-red-400 text-xs mt-1.5">{usernameError}</Text>
        )}
      </View>

      {/* Goal */}
      <View className="px-4 py-3.5 border-b border-zinc-800">
        <Text className="text-zinc-300 text-sm mb-2.5">Goal</Text>
        <View className="flex-row flex-wrap gap-2">
          {GOALS.map((g) => (
            <TouchableOpacity
              key={g.key}
              onPress={() => setGoal(g.key)}
              className="px-3 py-1.5 rounded-full border"
              style={{
                backgroundColor: goal === g.key ? 'white' : '#18181b',
                borderColor: goal === g.key ? 'white' : '#3f3f46',
              }}
            >
              <Text
                className="text-xs font-medium"
                style={{ color: goal === g.key ? 'black' : '#a1a1aa' }}
              >
                {g.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TargetRow label="Protein target" value={protein} onChangeText={setProtein} unit="g" placeholder="160" />
      <TargetRow label="Water target" value={water} onChangeText={setWater} unit="ml" placeholder="2800" />
      <TargetRow label="Calorie target" value={calories} onChangeText={setCalories} unit="kcal" placeholder="2400" />

      {/* Bedtime */}
      <View className="flex-row items-center justify-between px-4 py-3.5 border-b border-zinc-800">
        <View className="flex-1 pr-3">
          <Text className="text-zinc-300 text-sm">Bedtime</Text>
          <Text className="text-zinc-600 text-xs mt-0.5">Drives caffeine-at-night scoring</Text>
        </View>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <TouchableOpacity
            onPress={() => setBedtime((h) => Math.max(0, h - 1))}
            className="w-8 h-8 rounded-full bg-zinc-800 items-center justify-center"
          >
            <Text className="text-white text-lg leading-5">−</Text>
          </TouchableOpacity>
          <Text className="text-white text-sm font-medium text-center" style={{ width: 76 }}>
            {hourLabel(bedtime)}
          </Text>
          <TouchableOpacity
            onPress={() => setBedtime((h) => Math.min(23, h + 1))}
            className="w-8 h-8 rounded-full bg-zinc-800 items-center justify-center"
          >
            <Text className="text-white text-lg leading-5">+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Save */}
      <TouchableOpacity
        onPress={onSave}
        disabled={save.isPending}
        className="px-4 py-4 items-center"
      >
        {save.isPending ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text
            className="text-sm font-semibold"
            style={{ color: saved ? '#22c55e' : '#ffffff' }}
          >
            {saved ? 'Saved ✓' : 'Save changes'}
          </Text>
        )}
      </TouchableOpacity>
    </Section>
  )
}

// ─── Device rows ────────────────────────────────────────────────────────────────

function AppleHealthRow({ device }: { device: ConnectedDevice | undefined }) {
  const qc = useQueryClient()
  const supported = isHealthKitPlatform()
  const connected = !!device

  const connect = useMutation({
    mutationFn: async () => {
      await requestHealthPermissions()
      await runHealthKitBackfill(14)
    },
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['devices'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const disconnect = useMutation({
    mutationFn: () => disconnectDevice('apple_health'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  })

  function confirmDisconnect() {
    Alert.alert(
      'Disconnect Apple Health',
      'Protocol will stop syncing sleep, HRV, and activity. Your past data stays. You can reconnect anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => disconnect.mutate() },
      ],
    )
  }

  const busy = connect.isPending || disconnect.isPending

  return (
    <View className="flex-row items-center justify-between px-4 py-4 border-b border-zinc-800">
      <View className="flex-1 pr-3">
        <Text className="text-white text-sm font-semibold">Apple Health</Text>
        <Text className="text-zinc-500 text-xs mt-0.5">
          {connected
            ? `Synced ${timeAgo(device!.last_sync_at)}`
            : 'Steps, sleep, heart rate'}
        </Text>
      </View>

      {busy ? (
        <ActivityIndicator color="white" />
      ) : connected ? (
        <TouchableOpacity onPress={confirmDisconnect}>
          <Text className="text-red-400 text-sm font-medium">Disconnect</Text>
        </TouchableOpacity>
      ) : supported ? (
        <TouchableOpacity
          onPress={() => connect.mutate()}
          className="bg-white px-3 py-1.5 rounded-lg"
        >
          <Text className="text-black text-xs font-semibold">Connect</Text>
        </TouchableOpacity>
      ) : (
        <View className="border border-zinc-700 px-2 py-0.5 rounded-full">
          <Text className="text-zinc-500 text-xs uppercase tracking-widest">iOS only</Text>
        </View>
      )}
    </View>
  )
}

function OuraRow({ device }: { device: ConnectedDevice | undefined }) {
  const qc = useQueryClient()
  const connected = !!device

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['devices'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const connect = useMutation({
    mutationFn: connectOura,
    onSuccess: (result) => {
      if (result === 'success') {
        hapticSuccess()
        refresh()
      } else if (result === 'error') {
        Alert.alert('Connection failed', 'Could not connect your Oura account. Please try again.')
      }
    },
    onError: () => Alert.alert('Connection failed', 'Could not start the Oura connection.'),
  })

  const sync = useMutation({ mutationFn: syncOura, onSuccess: refresh })

  const disconnect = useMutation({
    mutationFn: () => disconnectDevice('oura'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  })

  function confirmDisconnect() {
    Alert.alert(
      'Disconnect Oura',
      'Protocol will stop syncing from Oura. Your past data stays. You can reconnect anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => disconnect.mutate() },
      ],
    )
  }

  const busy = connect.isPending || disconnect.isPending || sync.isPending

  return (
    <View className="flex-row items-center justify-between px-4 py-4">
      <View className="flex-1 pr-3">
        <Text className="text-white text-sm font-semibold">Oura Ring</Text>
        <Text className="text-zinc-500 text-xs mt-0.5">
          {connected ? `Synced ${timeAgo(device!.last_sync_at)}` : 'Sleep, HRV, readiness'}
        </Text>
      </View>

      {busy ? (
        <ActivityIndicator color="white" />
      ) : connected ? (
        <View className="flex-row items-center" style={{ gap: 14 }}>
          <TouchableOpacity onPress={() => sync.mutate()}>
            <Text className="text-zinc-300 text-sm font-medium">Sync</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={confirmDisconnect}>
            <Text className="text-red-400 text-sm font-medium">Disconnect</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          onPress={() => connect.mutate()}
          className="bg-white px-3 py-1.5 rounded-lg"
        >
          <Text className="text-black text-xs font-semibold">Connect</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

// ─── Settings Screen ─────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { user, clearAuth } = useAuthStore()

  const { data: devices = [], isLoading } = useQuery<ConnectedDevice[]>({
    queryKey: ['devices'],
    queryFn: fetchConnectedDevices,
  })

  const apple = devices.find((d) => d.provider === 'apple_health')
  const oura = devices.find((d) => d.provider === 'oura')

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
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-4 pt-2 pb-4">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} className="pr-3 py-1">
          <Text className="text-zinc-400 text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-lg font-bold">Settings</Text>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <ProfileSection />

        <Section title="Devices">
          {isLoading ? (
            <View className="px-4 py-6 items-center">
              <ActivityIndicator color="#71717a" />
            </View>
          ) : (
            <>
              <AppleHealthRow device={apple} />
              <OuraRow device={oura} />
            </>
          )}
        </Section>

        <Section title="Account">
          <View className="px-4 py-4 border-b border-zinc-800">
            <Text className="text-zinc-500 text-xs">Signed in as</Text>
            <Text className="text-white text-sm mt-0.5">{user?.email ?? '—'}</Text>
          </View>
          <TouchableOpacity onPress={signOut} className="px-4 py-4">
            <Text className="text-red-400 text-sm font-medium">Sign out</Text>
          </TouchableOpacity>
        </Section>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
