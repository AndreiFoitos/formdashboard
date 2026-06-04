import { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { usePendingInviteStore } from '../../store/pendingInvite'

interface RedeemResponse {
  status: 'created' | 'already_friends' | 'already_pending'
  inviter: { id: string; name: string; username: string | null }
  friendship_id?: string
  direction?: 'incoming' | 'outgoing'
}

type State =
  | { kind: 'loading' }
  | { kind: 'success'; res: RedeemResponse }
  | { kind: 'error'; message: string }

function inviterLabel(u: { name: string; username: string | null }): string {
  return u.username ? `@${u.username}` : u.name
}

// Deep-link target for peakform://invite/<token>. Behaviour:
// - logged out:   stash token + bounce to /login (login screen handles redeem)
// - logged in:    POST /redeem then surface a small success/error screen
// - hydration not done yet: wait for auth state to settle before deciding
export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const user = useAuthStore((s) => s.user)
  const hydrated = useAuthStore((s) => s.hydrated)
  const setPending = usePendingInviteStore((s) => s.set)
  const qc = useQueryClient()

  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    if (!hydrated) return
    if (!token || typeof token !== 'string') {
      setState({ kind: 'error', message: 'Invite link is missing a token.' })
      return
    }

    if (!user) {
      setPending(token)
      router.replace('/login')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.post<RedeemResponse>(`/friends/invites/${token}/redeem`)
        if (cancelled) return
        // Refresh friends + leaderboard caches so the new pending request shows up.
        qc.invalidateQueries({ queryKey: ['friends-list'] })
        qc.invalidateQueries({ queryKey: ['friends-leaderboard'] })
        setState({ kind: 'success', res: data })
      } catch (err: any) {
        if (cancelled) return
        const message =
          err?.response?.data?.detail ?? 'This invite link is not available.'
        setState({ kind: 'error', message })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [hydrated, user?.id, token])

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top', 'bottom']}>
      <View className="flex-1 justify-center items-center px-6">
        {state.kind === 'loading' && <ActivityIndicator color="#ffffff" />}

        {state.kind === 'success' && (
          <View className="items-center">
            <Text className="text-white text-2xl font-semibold mb-2 text-center">
              {state.res.status === 'created' && `Friend request from ${inviterLabel(state.res.inviter)}`}
              {state.res.status === 'already_pending' && `Pending with ${inviterLabel(state.res.inviter)}`}
              {state.res.status === 'already_friends' && `Already friends with ${inviterLabel(state.res.inviter)}`}
            </Text>
            <Text className="text-zinc-500 text-sm mb-8 text-center">
              {state.res.status === 'created'
                ? 'Open Friends to accept and start showing up on each other’s leaderboard.'
                : state.res.status === 'already_pending'
                  ? 'Already in your inbox.'
                  : 'You’re set.'}
            </Text>
            <TouchableOpacity
              onPress={() => router.replace('/friends')}
              className="bg-white rounded-2xl px-8 py-3"
            >
              <Text className="text-black font-semibold text-sm">Open Friends</Text>
            </TouchableOpacity>
          </View>
        )}

        {state.kind === 'error' && (
          <View className="items-center">
            <Text className="text-white text-xl font-semibold mb-2 text-center">
              Invite unavailable
            </Text>
            <Text className="text-zinc-500 text-sm mb-8 text-center">{state.message}</Text>
            <TouchableOpacity
              onPress={() => router.replace('/')}
              className="bg-white rounded-2xl px-8 py-3"
            >
              <Text className="text-black font-semibold text-sm">Continue</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}
