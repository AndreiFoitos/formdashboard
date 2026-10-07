import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { Check, RotateCcw } from 'lucide-react-native'
import { handleLimitError, openPaywall, usePlan, useSetPlan } from '../../hooks/usePlan'
import { PREFERENCES_KEY } from '../../hooks/usePreferences'
import { useKeyboardOverlap } from '../../hooks/useKeyboardOverlap'
import { colors } from '../../theme/tokens'
import { tabBarClearance } from '../../theme/layout'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface Action {
  type: string
  summary: string
  undone: boolean
}

interface Turn {
  id?: string
  role: 'user' | 'assistant'
  content: string
  actions?: Action[]
  /** Only the newest message that changed something can be undone. */
  undoable?: boolean
}

// The Pit Crew chat: ask your data, and ask for changes ("I hate salmon",
// "swap lunges"). POST /plan-ai/chat runs Claude with tools that edit the
// plan; changes come back as `actions` and show as chips with Undo. Saved on
// the server. Lives under the Chat segment of the Pit tab (app/(tabs)/ask.tsx).

const SUGGESTIONS = [
  'Is my weight moving at the right speed for my goal?',
  'Am I getting stronger on my main lifts?',
  "I don't like one of my meals, swap it",
  'I ate something off-plan today',
]

const MESSAGES_KEY = ['ai', 'messages']

export function ChatPanel() {
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
      setTurns(saved.data)
      setLoaded(true)
      scrollDown()
    }
  }, [saved.data, loaded])
  const [input, setInput] = useState('')
  const { data: plan } = usePlan()
  const refreshPlan = useSetPlan()
  const asksLeft = plan?.scans.ask
  const scrollRef = useRef<ScrollView>(null)
  const rootRef = useRef<View>(null)
  // Lifts the input bar above the keyboard (KeyboardAvoidingView got the
  // offset wrong here and the keyboard covered the input and Send).
  const keyboardOverlap = useKeyboardOverlap(rootRef)
  // The native tab bar overlays the screen; the keyboard covers it when up.
  const insets = useSafeAreaInsets()
  const bottomPad = Math.max(keyboardOverlap, tabBarClearance(insets.bottom))
  useEffect(() => {
    if (keyboardOverlap > 0) scrollDown()
  }, [keyboardOverlap])

  const scrollDown = () =>
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50)

  // Plan changes touch the plan, today, preferences, targets and food log.
  function refreshAfterChanges() {
    qc.invalidateQueries({ queryKey: ['plan-ai'] })
    qc.invalidateQueries({ queryKey: PREFERENCES_KEY })
    qc.invalidateQueries({ queryKey: ['nutrition-today'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const ask = useMutation({
    mutationFn: (message: string) =>
      api
        .post('/plan-ai/chat', { message }, { timeout: 120_000 })
        .then((r) => r.data as { id: string; answer: string; actions: Action[]; undoable: boolean }),
    onSuccess: (res) => {
      setTurns((t) => [
        // A new change makes earlier ones no longer undoable.
        ...t.map((x) => (res.undoable ? { ...x, undoable: false } : x)),
        { id: res.id, role: 'assistant', content: res.answer, actions: res.actions, undoable: res.undoable },
      ])
      if (res.actions.length) refreshAfterChanges()
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

  const undo = useMutation({
    mutationFn: (id: string) => api.post(`/plan-ai/chat/${id}/undo`).then((r) => r.data),
    onSuccess: (_d, id) => {
      setTurns((t) =>
        t.map((x) =>
          x.id === id ? { ...x, undoable: false, actions: x.actions?.map((a) => ({ ...a, undone: true })) } : x,
        ),
      )
      refreshAfterChanges()
      qc.invalidateQueries({ queryKey: MESSAGES_KEY })
    },
    onError: (e: any) =>
      Alert.alert("Couldn't undo", e?.response?.data?.detail ?? 'Please try again.'),
  })

  function send(q: string) {
    const question = q.trim()
    if (!question || ask.isPending) return
    setTurns((t) => [...t, { role: 'user', content: question }])
    setInput('')
    ask.mutate(question)
    scrollDown()
  }

  return (
    <View ref={rootRef} className="flex-1" style={{ paddingBottom: bottomPad }}>
      <View className="flex-row items-center justify-between px-4 pb-2" style={{ minHeight: 24 }}>
        {asksLeft ? (
          <TouchableOpacity onPress={() => openPaywall('ask')} hitSlop={10}>
            <Text className="text-text-subtle text-caption">
              {asksLeft.remaining}/{asksLeft.limit} questions left today
            </Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}
        {turns.length > 0 && (
          <TouchableOpacity onPress={confirmClear} disabled={ask.isPending || clear.isPending} hitSlop={10}>
            <Text className="text-text-muted text-caption font-medium">New chat</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        ref={scrollRef}
        className="flex-1 px-4"
        contentContainerClassName="pb-4"
        keyboardShouldPersistTaps="handled"
      >
        {!loaded && saved.isLoading ? (
          <ActivityIndicator color={colors['text-subtle']} className="mt-6" />
        ) : turns.length === 0 ? (
          <View className="gap-3 mt-2">
            <Text className="text-text-subtle text-footnote mb-1">
              Ask anything about your training, nutrition, body, or Form Score over the
              last {plan?.history_days ?? 30} days, or ask your crew to change your plan.
            </Text>
            {SUGGESTIONS.map((s) => (
              <TouchableOpacity
                key={s}
                onPress={() => send(s)}
                className="bg-surface border border-divider rounded-xl px-4 py-3" style={{ borderCurve: 'continuous' }}
              >
                <Text className="text-text-muted text-footnote">{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View className="gap-3">
            {turns.map((t, i) => (
              <View key={i} className={t.role === 'user' ? 'items-end' : 'items-start'}>
                <View
                  className="rounded-xl px-4 py-3"
                  style={{
                    borderCurve: 'continuous', maxWidth: '85%',
                    backgroundColor: t.role === 'user' ? colors.text : colors.surface,
                    borderWidth: t.role === 'user' ? 0 : 1,
                    borderColor: colors.divider,
                  }}
                >
                  <Text
                    className="text-footnote"
                    style={{ color: t.role === 'user' ? colors.bg : colors.text }}
                  >
                    {t.content}
                  </Text>
                </View>
                {!!t.actions?.length && (
                  <View className="mt-2 gap-1" style={{ maxWidth: '85%' }}>
                    {t.actions.map((a, j) => (
                      <View key={j} className="flex-row items-start gap-2">
                        <View className="h-4 justify-center">
                          <Check size={13} color={a.undone ? colors['text-subtle'] : colors.success} strokeWidth={3} />
                        </View>
                        <Text
                          className="text-caption flex-1"
                          style={{ color: a.undone ? colors['text-subtle'] : colors['text-muted'], textDecorationLine: a.undone ? 'line-through' : 'none' }}
                        >
                          {a.summary}
                        </Text>
                      </View>
                    ))}
                    {t.undoable && t.id && (
                      <TouchableOpacity
                        onPress={() => undo.mutate(t.id!)}
                        disabled={undo.isPending}
                        hitSlop={8}
                        className="flex-row items-center self-start mt-1 px-3 py-2 rounded-full bg-surface border border-divider gap-2"
                        style={{ borderCurve: 'continuous' }}
                      >
                        {undo.isPending ? (
                          <ActivityIndicator size="small" color={colors.text} />
                        ) : (
                          <RotateCcw size={12} color={colors.text} />
                        )}
                        <Text className="text-text text-caption font-medium">Undo</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            ))}
            {ask.isPending && (
              <View className="items-start">
                <View className="rounded-xl px-4 py-3 bg-surface border border-divider" style={{ borderCurve: 'continuous' }}>
                  <ActivityIndicator color={colors['text-muted']} />
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <View className="flex-row items-end gap-2 px-4 pb-3 pt-2 border-t border-divider">
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask your crew…"
          placeholderTextColor={colors['text-subtle']}
          multiline
          className="flex-1 bg-surface-raised border border-border rounded-md px-4 py-3 text-text text-footnote"
          style={{ borderCurve: 'continuous', maxHeight: 120 }}
        />
        <TouchableOpacity
          onPress={() => send(input)}
          disabled={!input.trim() || ask.isPending}
          className="bg-accent rounded-md px-4 py-3 items-center justify-center"
          style={{ borderCurve: 'continuous', opacity: !input.trim() || ask.isPending ? 0.4 : 1 }}
        >
          <Text className="text-on-accent font-semibold text-footnote">Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
