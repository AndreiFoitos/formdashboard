import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native'
import { router } from 'expo-router'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { setToken } from '../lib/storage'
import SsoButtons from '../components/SsoButtons'
import { FEATURES } from '../lib/featureFlags'
import { extractErrorMessage } from '../lib/apiError'

export default function LoginScreen() {
  const { setAuth } = useAuthStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
      className="flex-1 bg-black"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 justify-center px-6">
          {/* Logo */}
          <Text className="text-white text-4xl font-bold mb-2">Protocol</Text>
          <Text className="text-zinc-500 text-sm mb-8">
            Your performance operating system
          </Text>

          {/* SSO */}
          {FEATURES.anySso && (
            <>
              <SsoButtons onError={setError} />
              <View className="flex-row items-center my-6">
                <View className="flex-1 h-px bg-zinc-800" />
                <Text className="px-3 text-zinc-600 text-xs uppercase tracking-widest">or</Text>
                <View className="flex-1 h-px bg-zinc-800" />
              </View>
            </>
          )}

          {/* Email */}
          <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-1.5">
            Email
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm mb-4"
          />

          {/* Password */}
          <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-1.5">
            Password
          </Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor="#52525b"
            secureTextEntry
            textContentType="password"
            className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm mb-4"
          />

          {/* Error */}
          {error && (
            <View className="bg-red-950 border border-red-900 rounded-xl px-4 py-3 mb-4">
              <Text className="text-red-400 text-sm">{error}</Text>
            </View>
          )}

          {/* Submit */}
          <TouchableOpacity
            onPress={handleLogin}
            disabled={loading}
            className="bg-white rounded-2xl py-4 items-center mb-4"
            style={{ opacity: loading ? 0.5 : 1 }}
          >
            {loading ? (
              <ActivityIndicator color="black" />
            ) : (
              <Text className="text-black font-semibold text-base">Sign in</Text>
            )}
          </TouchableOpacity>

          {/* Register link */}
          <TouchableOpacity onPress={() => router.push('/register')}>
            <Text className="text-zinc-500 text-sm text-center">
              No account?{' '}
              <Text className="text-white">Create one</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}