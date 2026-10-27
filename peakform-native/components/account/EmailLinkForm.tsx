import { useState } from 'react'
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { Stack, router } from 'expo-router'
import { extractErrorMessage } from '../../lib/apiError'
import { colors } from '../../theme/tokens'

// One email field in a Cancel/Send modal that asks the backend to email a link
// (add email, forgot password). After sending it swaps to a "check your inbox"
// note, since the rest happens on the page the link opens.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function EmailLinkForm({
  title,
  intro,
  initialEmail = '',
  sentNote,
  send,
}: {
  title: string
  intro: string
  initialEmail?: string
  sentNote: (email: string) => string
  send: (email: string) => Promise<unknown>
}) {
  const [email, setEmail] = useState(initialEmail)
  const [pending, setPending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const value = email.trim()
    if (!EMAIL_RE.test(value)) return setError('Enter a valid email.')
    setError(null)
    setPending(true)
    try {
      await send(value)
      setSentTo(value)
    } catch (e) {
      setError(extractErrorMessage(e, "Couldn't send the email. Try again."))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="py-2">
              <Text className="text-text text-body">{sentTo ? 'Close' : 'Cancel'}</Text>
            </TouchableOpacity>
          ),
          headerRight: () =>
            sentTo ? null : pending ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <TouchableOpacity onPress={submit} hitSlop={12} className="py-2">
                <Text className="text-text text-body font-semibold">Send</Text>
              </TouchableOpacity>
            ),
        }}
      />
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1 bg-surface" contentContainerClassName="px-4 pt-6 pb-12" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {sentTo ? (
          <View className="px-4">
            <Text className="text-text text-headline mb-2">Check your email</Text>
            <Text className="text-text-muted text-body">{sentNote(sentTo)}</Text>
          </View>
        ) : (
          <>
            <Text className="text-text-muted text-footnote mb-3 px-4">{intro}</Text>
            <View className="bg-surface-raised border border-border rounded-md px-4" style={{ borderCurve: 'continuous' }}>
              <TextInput
                value={email}
                onChangeText={(v) => {
                  setEmail(v)
                  setError(null)
                }}
                placeholder="you@example.com"
                placeholderTextColor={colors['text-subtle']}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="send"
                onSubmitEditing={submit}
                className="py-3 text-text text-body"
              />
            </View>
            {error && <Text className="text-danger text-footnote mt-2 px-4">{error}</Text>}
          </>
        )}
      </ScrollView>
    </>
  )
}
