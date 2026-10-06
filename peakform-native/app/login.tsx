import { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
} from 'react-native'
import { router } from 'expo-router'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { usePendingInviteStore } from '../store/pendingInvite'
import { setToken } from '../lib/storage'
import SsoButtons from '../components/SsoButtons'
import { FEATURES } from '../lib/featureFlags'
import { extractErrorMessage } from '../lib/apiError'
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../lib/legal'
import { colors } from '../theme/tokens'

interface InviterPreview {
  name: string
  username: string | null
}

export default function LoginScreen() {
  const { setAuth } = useAuthStore()
  const pendingInviteToken = usePendingInviteStore((s) => s.token)
  const clearPendingInvite = usePendingInviteStore((s) => s.clear)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [inviterPreview, setInviterPreview] = useState<InviterPreview | null>(null)

  // Pull the inviter's public name/username so we can render
  // "Log in to accept @andrei's invite". Drops the pending token on the floor
  // if the link is revoked or expired — silently, no banner shown.
  useEffect(() => {
    if (!pendingInviteToken) {
      setInviterPreview(null)
      return
    }
    let cancelled = false
    api
      .get(`/friends/invites/${pendingInviteToken}/preview`)
      .then((r) => {
        if (cancelled) return
        const data = r.data as { inviter: InviterPreview; revoked: boolean; expired: boolean }
        if (data.revoked || data.expired) {
          clearPendingInvite()
          return
        }
        setInviterPreview(data.inviter)
      })
      .catch(() => {
        if (cancelled) return
        clearPendingInvite()
      })
    return () => {
      cancelled = true
    }
  }, [pendingInviteToken])

  async function handleLogin() {
    setError(null)
    setLoading(true)

    try {
      const { data: tokens } = await api.post('/auth/login', { email, password })

      // Persist refresh token in SecureStore (survives app restarts)
      await setToken('refresh_token', tokens.refresh_token)

      // Fetch the user profile with the fresh access token
      const { data: user } = await api.get('/users/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })

      setAuth(user, tokens.access_token)

      // Pending invite from a deep-link tap? Redeem now and route to Friends.
      // Best-effort: swallow errors so a flaky invite never blocks login.
      if (pendingInviteToken) {
        try {
          await api.post(`/friends/invites/${pendingInviteToken}/redeem`, undefined, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          })
        } catch {
          // Token may have been revoked between preview and login. Continue.
        }
        clearPendingInvite()
        // Onboarding still takes priority — accepting an invite from your inbox
        // can wait until after you've finished signup.
        router.replace(user.onboarding_complete ? '/friends' : '/onboarding')
        return
      }

      // Navigate based on onboarding state
      router.replace(user.onboarding_complete ? '/' : '/onboarding')
    } catch (err: any) {
      setError(extractErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    // KeyboardAvoidingView pushes content up when the keyboard appears
    <KeyboardAvoidingView
      className="flex-1 bg-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 justify-center px-6">
          {/* Logo */}
          <Image
            source={require('../assets/logo-dark.png')}
            className="mb-3 self-center"
            style={{ width: 320, height: 110 }}
            resizeMode="contain"
          />
          <Text className="text-text-subtle text-footnote mb-8 text-center">
            Your performance operating system
          </Text>

          {/* Pending invite banner — shown if user tapped gainrace://invite/<token>
              while logged out. After successful login we auto-redeem. */}
          {inviterPreview && (
            <View className="bg-surface border border-divider rounded-xl px-4 py-3 mb-6" style={{ borderCurve: 'continuous' }}>
              <Text className="text-text-subtle text-caption mb-1">
                Pending invite
              </Text>
              <Text className="text-text text-footnote">
                Log in to accept{' '}
                <Text className="font-semibold">
                  {inviterPreview.username ? `@${inviterPreview.username}` : inviterPreview.name}
                </Text>
                ’s invite
              </Text>
            </View>
          )}

          {/* SSO */}
          {FEATURES.anySso && (
            <>
              <SsoButtons onError={setError} />
              <View className="flex-row items-center my-6">
                <View className="flex-1 h-px bg-surface-raised" />
                <Text className="px-3 text-text-subtle text-caption">or</Text>
                <View className="flex-1 h-px bg-surface-raised" />
              </View>
            </>
          )}

          {/* Email */}
          <Text className="text-text-muted text-caption mb-2">
            Email
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors['text-subtle']}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            className="bg-surface-raised border border-border rounded-md px-4 py-4 text-text text-footnote mb-4" style={{ borderCurve: 'continuous' }}
          />

          {/* Password */}
          <Text className="text-text-muted text-caption mb-2">
            Password
          </Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors['text-subtle']}
            secureTextEntry
            textContentType="password"
            className="bg-surface-raised border border-border rounded-md px-4 py-4 text-text text-footnote mb-4" style={{ borderCurve: 'continuous' }}
          />

          {/* Error */}
          {error && (
            <View className="bg-danger/15 border border-danger/40 rounded-xl px-4 py-3 mb-4" style={{ borderCurve: 'continuous' }}>
              <Text className="text-danger text-footnote">{error}</Text>
            </View>
          )}

          {/* Submit */}
          <TouchableOpacity
            onPress={handleLogin}
            disabled={loading}
            className="bg-accent rounded-md py-4 items-center mb-4"
            style={{ borderCurve: 'continuous', opacity: loading ? 0.5 : 1 }}
          >
            {loading ? (
              <ActivityIndicator color={colors['on-accent']} />
            ) : (
              <Text className="text-on-accent font-semibold text-body">Sign in</Text>
            )}
          </TouchableOpacity>

          {/* Register link */}
          <TouchableOpacity onPress={() => router.push('/register')}>
            <Text className="text-text-subtle text-footnote text-center">
              No account?{' '}
              <Text className="text-text">Create one</Text>
            </Text>
          </TouchableOpacity>

          {/* Legal — Apple wants the link above-the-fold from the auth screens */}
          <Text className="text-text-subtle text-caption text-center mt-6 px-2">
            By signing in you agree to our{' '}
            <Text
              className="text-text-muted underline"
              onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)}
            >
              Terms
            </Text>{' '}
            and{' '}
            <Text
              className="text-text-muted underline"
              onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
            >
              Privacy policy
            </Text>
            .
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}