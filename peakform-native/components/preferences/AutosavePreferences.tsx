import { useEffect, useState, type ReactNode } from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import {
  EMPTY_PREFERENCES,
  type Preferences,
  usePreferences,
  useSavePreferences,
} from '../../hooks/usePreferences'
import { extractErrorMessage } from '../../lib/apiError'
import { colors } from '../../theme/tokens'

// Settings → Training / Nutrition preferences. Every change saves as soon as
// it's made (DESIGN.md §6: no global Save); a rejected change rolls back and
// shows inline.

export function AutosavePreferences({
  intro,
  children,
  footer,
}: {
  intro: string
  children: (value: Preferences, onChange: (p: Partial<Preferences>) => void) => ReactNode
  footer?: ReactNode
}) {
  const { data, isLoading } = usePreferences()
  const save = useSavePreferences()
  const [prefs, setPrefs] = useState<Preferences>(EMPTY_PREFERENCES)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (data) setPrefs(data)
  }, [data])

  function onChange(p: Partial<Preferences>) {
    setError(null)
    setPrefs((cur) => ({ ...cur, ...p }))
    save.mutate(p, {
      onError: (e) => {
        if (data) setPrefs(data)
        setError(extractErrorMessage(e, "Couldn't save that change. Try again."))
      },
    })
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-bg">
        <ActivityIndicator color={colors['text-subtle']} className="mt-12" />
      </View>
    )
  }

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-4 pt-4 pb-12"
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-text-subtle text-footnote mb-6">{intro}</Text>
      {error && (
        <View className="bg-danger/15 border border-danger/40 rounded-xl px-4 py-3 mb-6" style={{ borderCurve: 'continuous' }}>
          <Text className="text-danger text-footnote">{error}</Text>
        </View>
      )}
      {children(prefs, onChange)}
      {footer}
    </ScrollView>
  )
}
