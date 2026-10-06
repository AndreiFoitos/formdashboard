import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { allSources } from '../../lib/methodology'
import { colors } from '../../theme/tokens'

// Flat, deduped list of every citation across all methodology topics.
// Reached from the bottom of /methodology.

function openSourceUrl(url?: string) {
  if (!url) return
  Linking.openURL(url).catch(() => {})
}

export default function MethodologySourcesScreen() {
  const sources = allSources()

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView
        className="flex-1 px-4"
        contentContainerClassName="pt-1 pb-12"
      >
        <Text className="text-text-subtle text-footnote mb-5">
          Every paper, guideline, and reference cited in the methodology pages.
        </Text>

        <View className="bg-surface border border-divider rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
          {sources.map((s, i) => {
            const isLast = i === sources.length - 1
            const Row = s.url ? TouchableOpacity : View
            return (
              <Row
                key={`${s.name}-${i}`}
                onPress={s.url ? () => openSourceUrl(s.url) : undefined}
                className="px-4 py-3 flex-row items-start"
                style={{
                  borderBottomWidth: isLast ? 0 : 1,
                  borderBottomColor: colors.divider,
                }}
              >
                <Text className="text-text-subtle text-caption mr-2 mt-1">•</Text>
                <View className="flex-1">
                  <Text
                    className="text-footnote"
                    style={{ color: s.url ? colors.text : colors['text-muted'], textDecorationLine: s.url ? 'underline' : 'none' }}
                  >
                    {s.name}
                  </Text>
                  {s.url && (
                    <Text className="text-text-subtle text-caption mt-1" numberOfLines={1}>
                      {s.url}
                    </Text>
                  )}
                </View>
              </Row>
            )
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
