import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { useRequireAuth } from '../../hooks/useRequireAuth'
import { handleLimitError, openPaywall, usePlan, useSetPlan } from '../../hooks/usePlan'

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'Is my weight moving at the right speed for my goal?',
  'Am I getting stronger on my main lifts?',
  'Am I hitting my protein target consistently?',
  "What's my biggest lever to raise my Form Score?",
]

const MESSAGES_KEY = ['ai', 'messages']

export default function AskScreen() {
  useRequireAuth()
  const [turns, setTurns] = useState<Turn[]>([])
  const qc = useQueryClient()
  // The chat is saved on the server (GET /ai/messages), so it survives
  // leaving the tab and restarting the app.
  const saved = useQuery<Turn[]>({
    queryKey: MESSAGES_KEY,
    queryFn: () => api.get('/ai/messages').then((r) => r.data.messages),
  })
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (saved.data && !loaded) {
      setTurns(saved.data.map((m) => ({ role: m.role, content: m.content })))
      setLoaded(true)
      scrollDown()
    }
  }, [saved.data, loaded])
  const [input, setInput] = useState('')
  const { data: plan } = usePlan()
  const refreshPlan = useSetPlan()
  const asksLeft = plan?.scans.ask
  const scrollRef = useRef<ScrollView>(null)

  const scrollDown = () =>
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50)

  const ask = useMutation({
    mutationFn: (question: string) =>
      api
        .post('/ai/ask', { question }, { timeout: 60_000 })
        .then((r) => r.data.answer as string),
    onSuccess: (answer) => {
      setTurns((t) => [...t, { role: 'assistant', content: answer }])
      qc.invalidateQueries({ queryKey: MESSAGES_KEY })
      refreshPlan()
      scrollDown()
    },
    onError: (e: any) => {
      const status = e?.response?.status
      // 402 = plan limit: open the paywall and say so in the thread.
      const hitLimit = handleLimitError(e)
      if (hitLimit) refreshPlan()
      const msg = hitLimit
        ? "You've used your questions for today. Upgrade for more, or come back tomorrow."
        : status === 503
          ? "AI isn't set up yet — add an Anthropic API key on the server to enable this."
          : status === 429
            ? "You've hit the daily question limit. Try again tomorrow."
            : 'Something went wrong. Please try again.'
      setTurns((t) => [...t, { role: 'assistant', content: msg }])
      scrollDown()
    },
  })

  const clear = useMutation({
    mutationFn: () => api.delete('/ai/messages'),
    onSuccess: () => {
      setTurns([])
      qc.setQueryData(MESSAGES_KEY, [])
    },
    onError: () => Alert.alert("Couldn't start a new chat", 'Please try again.'),
  })

  function confirmClear() {
    Alert.alert('Start a new chat?', 'This conversation will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'New chat', style: 'destructive', onPress: () => clear.mutate() },
    ])
  }

  function send(q: string) {
    const question = q.trim()
    if (!question || ask.isPending) return
    setTurns((t) => [...t, { role: 'user', content: question }])
    setInput('')
    ask.mutate(question)
    scrollDown()
  }

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="px-4 pt-6 pb-3">
          <Text className="text-zinc-400 text-xs uppercase tracking-widest font-semibold">Ask</Text>
          <View className="flex-row items-end justify-between">
            <Text className="text-white text-3xl font-bold mt-1.5">Your Data</Text>
            <View className="items-end pb-1.5" style={{ gap: 6 }}>
              {turns.length > 0 && (
                <TouchableOpacity onPress={confirmClear} disabled={ask.isPending || clear.isPending} hitSlop={10}>
                  <Text className="text-zinc-300 text-xs font-medium">New chat</Text>
                </TouchableOpacity>
              )}
              {asksLeft && (
                <TouchableOpacity onPress={() => openPaywall('ask')} hitSlop={10}>
                  <Text className="text-zinc-500 text-xs">
                    {asksLeft.remaining}/{asksLeft.limit} questions left today
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {!loaded && saved.isLoading ? (
            <ActivityIndicator color="#71717a" style={{ marginTop: 24 }} />
          ) : turns.length === 0 ? (
            <View style={{ gap: 10, marginTop: 8 }}>
              <Text className="text-zinc-500 text-sm leading-6 mb-1">
                Ask anything about your training, nutrition, body, or Form Score over the
                last {plan?.history_days ?? 30} days.
              </Text>
              {SUGGESTIONS.map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => send(s)}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3"
                >
                  <Text className="text-zinc-300 text-sm">{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {turns.map((t, i) => (
                <View key={i} className={t.role === 'user' ? 'items-end' : 'items-start'}>
                  <View
                    className="rounded-2xl px-4 py-3"
                    style={{
                      maxWidth: '85%',
                      backgroundColor: t.role === 'user' ? '#ffffff' : '#18181b',
                      borderWidth: t.role === 'user' ? 0 : 1,
                      borderColor: '#27272a',
                    }}
                  >
                    <Text
                      className="text-sm leading-6"
                      style={{ color: t.role === 'user' ? 'black' : '#e4e4e7' }}
                    >
                      {t.content}
                    </Text>
                  </View>
                </View>
              ))}
              {ask.isPending && (
                <View className="items-start">
                  <View className="rounded-2xl px-4 py-3 bg-zinc-900 border border-zinc-800">
                    <ActivityIndicator color="#a1a1aa" />
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        <View className="flex-row items-end gap-2 px-4 pb-3 pt-2 border-t border-zinc-900">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask about your data…"
            placeholderTextColor="#52525b"
            multiline
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-white text-sm"
            style={{ maxHeight: 120 }}
          />
          <TouchableOpacity
            onPress={() => send(input)}
            disabled={!input.trim() || ask.isPending}
            className="bg-white rounded-2xl px-4 py-3 items-center justify-center"
            style={{ opacity: !input.trim() || ask.isPending ? 0.4 : 1 }}
          >
            <Text className="text-black font-semibold text-sm">Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
