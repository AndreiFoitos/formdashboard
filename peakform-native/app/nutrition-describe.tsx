import { useState } from 'react'
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { Mic } from 'lucide-react-native'
import { api } from '../api/client'
import { AnalyzingOverlay, type AnalyzeStage } from '../components/AnalyzingOverlay'
import { PressableScale } from '../components/PressableScale'
import { ScanLimitCard, ScanQuotaPill } from '../components/ScanQuota'
import { handleLimitError, usePlan, useSetPlan } from '../hooks/usePlan'
import { extractErrorMessage } from '../lib/apiError'
import { hapticSuccess } from '../lib/haptics'
import { colors } from '../theme/tokens'

// Describe a meal: type (or dictate with the keyboard's mic) what you ate,
// get the foods with amounts and calories back, review them on
// nutrition-confirm. Voice uses the system keyboard's dictation on purpose:
// no microphone permission, no native module (docs/describe-meal-research.md D5).

const MAX_CHARS = 500 // matches the backend's MAX_TEXT_CHARS

// Same three backend steps as the photo scan (services/nutrition_text.py),
// with a faster first step: reading text is quicker than reading a photo.
const STAGES: AnalyzeStage[] = [
  { label: 'Reading your meal', startsAtMs: 0 },
  { label: 'Matching to USDA database', startsAtMs: 4000 },
  { label: 'Choosing portions', startsAtMs: 5500 },
]

export default function NutritionDescribeScreen() {
  // for=meal: opened from the meal builder. text: coming back from the review
  // screen's "Edit description".
  const params = useLocalSearchParams<{ for?: string; text?: string }>()
  const forMeal = params.for === 'meal'
  const [text, setText] = useState(typeof params.text === 'string' ? params.text : '')
  const [busy, setBusy] = useState(false)
  const { data: plan } = usePlan()
  const refreshPlan = useSetPlan()
  // Its own allowance, separate from photo scans (backend services/plans.py).
  const usage = plan?.scans.describe
  const outOfScans = usage?.remaining === 0
  const trimmed = text.trim()
  const canSend = trimmed.length >= 2 && !busy && !outOfScans

  async function handleEstimate() {
    if (!canSend) return
    setBusy(true)
    try {
      const { data: estimate } = await api.post(
        '/nutrition/estimate/text',
        { text: trimmed },
        { timeout: 60_000 },
      )
      hapticSuccess()
      refreshPlan()
      router.replace({
        pathname: '/nutrition-confirm',
        params: {
          estimate: JSON.stringify(estimate),
          text: trimmed,
          ...(forMeal ? { for: 'meal' } : {}),
        },
      })
    } catch (err: any) {
      setBusy(false)
      if (handleLimitError(err)) {
        refreshPlan()
        return
      }
      const msg =
        err?.response?.status === 503
          ? 'AI service is not configured. Add ANTHROPIC_API_KEY to backend/.env.'
          : extractErrorMessage(err, 'Could not read that. Try again or log the foods by hand.')
      Alert.alert("Couldn't estimate meal", msg)
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Describe a meal',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="py-2">
              <Text className="text-text text-body">Cancel</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <View className="flex-1 bg-surface">
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="px-4 pt-4 pb-12 gap-3"
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            maxLength={MAX_CHARS}
            placeholder="e.g. 200 g of steak, about 250 g of mashed potatoes made with milk and butter, and a bit of olive oil"
            placeholderTextColor={colors['text-subtle']}
            className="bg-surface-raised border border-border rounded-md px-4 py-3 text-text text-body"
            style={{ borderCurve: 'continuous', minHeight: 140, textAlignVertical: 'top' }}
          />
          <View className="flex-row gap-2">
            <Mic size={16} color={colors['text-subtle']} strokeWidth={2} />
            <Text className="text-text-subtle text-caption flex-1">
              Tap the mic on your keyboard to say it instead. Name each food and roughly how much;
              anything you leave out is estimated and shown so you can change it.
            </Text>
          </View>

          {outOfScans && usage ? (
            <View className="mt-3">
              <ScanLimitCard
                kind="describe"
                usage={usage}
                onAlternative={() => router.back()}
                alternativeLabel="Log the meal by hand instead"
              />
            </View>
          ) : (
            <>
              <PressableScale
                haptic
                onPress={handleEstimate}
                disabled={!canSend}
                className="bg-accent rounded-md py-4 items-center mt-3"
                style={{ borderCurve: 'continuous', opacity: canSend ? 1 : 0.4 }}
              >
                <Text className="text-on-accent font-semibold text-body">Estimate calories</Text>
              </PressableScale>
              <View className="items-center">
                <ScanQuotaPill kind="describe" usage={usage} />
              </View>
            </>
          )}
        </ScrollView>
        {busy && <AnalyzingOverlay stages={STAGES} />}
      </View>
    </>
  )
}
