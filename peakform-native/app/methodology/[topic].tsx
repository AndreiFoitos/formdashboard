import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, useLocalSearchParams } from 'expo-router'
import { getTopic } from '../../lib/methodology'
import { colors } from '../../theme/tokens'

// One methodology topic — rendered from lib/methodology.ts.
// Prose paragraph(s), monospaced formula block, bulleted citations with
// optional URL link.

function openSourceUrl(url?: string) {
  if (!url) return
  Linking.openURL(url).catch(() => {})
}

export default function MethodologyTopicScreen() {
  const { topic } = useLocalSearchParams<{ topic: string }>()
  const data = typeof topic === 'string' ? getTopic(topic) : undefined

  if (!data) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
        <Stack.Screen options={{ title: 'Not found' }} />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-text-subtle text-footnote text-center">
            That topic doesn't exist. It may have been renamed.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <Stack.Screen options={{ title: data.title }} />
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        className="flex-1 px-4"
        contentContainerClassName="pt-1 pb-12"
      >
        <Text className="text-text-muted text-footnote mb-6">{data.prose}</Text>

        <Text className="text-text-subtle text-caption mb-2">Formula</Text>
        <View className="bg-surface border border-divider rounded-xl px-4 py-4 mb-6" style={{ borderCurve: 'continuous' }}>
          <Text
            className="text-text text-caption"
            style={{
              // RN doesn't have a monospace utility in nativewind — set the
              // platform-default monospace family inline.
              fontFamily: 'Menlo',
            }}
          >
            {data.formula}
          </Text>
        </View>

        <Text className="text-text-subtle text-caption mb-2">Sources</Text>
        <View className="bg-surface border border-divider rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
          {data.sources.map((s, i) => {
            const isLast = i === data.sources.length - 1
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
