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

export default function RegisterScreen() {
  const { setAuth } = useAuthStore()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleRegister() {
    setError(null)
    setLoading(true)

    try {
      const { data: tokens } = await api.post('/auth/register', {
        email,
        password,
        name: name.trim() || null,
      })

      // Persist refresh token in SecureStore
      await setToken('refresh_token', tokens.refresh_token)

      // Fetch the user profile with the fresh access token
      const { data: user } = await api.get('/users/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })

      setAuth(user, tokens.access_token)

      // New users always go to onboarding
      router.replace('/onboarding')
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
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
          <Text className="text-zinc-500 text-sm mb-10">Set up your account</Text>

          {/* Name */}
          <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-1.5">
            Name{' '}
            <Text className="text-zinc-600 normal-case">(optional)</Text>
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Alex"
            placeholderTextColor="#52525b"
            autoCorrect={false}
            textContentType="name"
            className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white text-sm mb-4"
          />

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
            placeholder="Min. 8 characters"
            placeholderTextColor="#52525b"
            secureTextEntry
            textContentType="newPassword"
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
            onPress={handleRegister}
            disabled={loading || !email || password.length < 8}
            className="bg-white rounded-2xl py-4 items-center mb-4"
            style={{ opacity: loading || !email || password.length < 8 ? 0.4 : 1 }}
          >
            {loading ? (
              <ActivityIndicator color="black" />
            ) : (
              <Text className="text-black font-semibold text-base">
                Create account
              </Text>
            )}
          </TouchableOpacity>

          {/* Login link */}
          <TouchableOpacity onPress={() => router.push('/login')}>
            <Text className="text-zinc-500 text-sm text-center">
              Already have an account?{' '}
              <Text className="text-white">Sign in</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}