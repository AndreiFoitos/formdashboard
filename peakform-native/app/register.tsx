import { useState } from 'react'
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
import { setToken } from '../lib/storage'
import SsoButtons from '../components/SsoButtons'
import { FEATURES } from '../lib/featureFlags'
import { extractErrorMessage } from '../lib/apiError'
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../lib/legal'
import { colors } from '../theme/tokens'

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
      setError(extractErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
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
          <Text className="text-text-subtle text-footnote mb-8 text-center">Set up your account</Text>

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

          {/* Name */}
          <Text className="text-text-muted text-caption mb-2">
            Name{' '}
            <Text className="text-text-subtle normal-case">(optional)</Text>
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Alex"
            placeholderTextColor={colors['text-subtle']}
            autoCorrect={false}
            textContentType="name"
            className="bg-surface-raised border border-border rounded-md px-4 py-4 text-text text-footnote mb-4" style={{ borderCurve: 'continuous' }}
          />

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
            placeholder="Min. 8 characters"
            placeholderTextColor={colors['text-subtle']}
            secureTextEntry
            textContentType="newPassword"
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
            onPress={handleRegister}
            disabled={loading || !email || password.length < 8}
            className="bg-accent rounded-md py-4 items-center mb-4"
            style={{ borderCurve: 'continuous', opacity: loading || !email || password.length < 8 ? 0.4 : 1 }}
          >
            {loading ? (
              <ActivityIndicator color={colors['on-accent']} />
            ) : (
              <Text className="text-on-accent font-semibold text-body">
                Create account
              </Text>
            )}
          </TouchableOpacity>

          {/* Login link */}
          <TouchableOpacity onPress={() => router.push('/login')}>
            <Text className="text-text-subtle text-footnote text-center">
              Already have an account?{' '}
              <Text className="text-text">Sign in</Text>
            </Text>
          </TouchableOpacity>

          {/* Legal — Apple wants the link above-the-fold from the auth screens */}
          <Text className="text-text-subtle text-caption text-center mt-6 px-2">
            By creating an account you agree to our{' '}
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