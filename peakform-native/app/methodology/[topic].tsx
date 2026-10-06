import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
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
        <View className="flex-row items-center px-4 pt-2 pb-4">
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="-ml-1 pr-4 py-2 flex-row items-center" style={{ gap: 2 }}>
            <ChevronLeft size={22} color={colors.text} strokeWidth={2.25} />
            <Text className="text-text-muted text-base font-medium">Back</Text>
          </TouchableOpacity>
          <Text className="text-text text-lg font-bold">Not found</Text>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-text-subtle text-sm text-center">
            That topic doesn't exist. It may have been renamed.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-4 pt-2 pb-4">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="-ml-1 pr-4 py-2 flex-row items-center" style={{ gap: 2 }}>
          <ChevronLeft size={22} color={colors.text} strokeWidth={2.25} />
          <Text className="text-text-muted text-base font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-text text-lg font-bold" numberOfLines={1} style={{ flex: 1 }}>
          {data.title}
        </Text>
      </View>

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 48 }}
      >
        <Text className="text-text-muted text-sm leading-6 mb-6">{data.prose}</Text>

        <Text className="text-text-subtle text-xs uppercase tracking-widest mb-2">Formula</Text>
        <View className="bg-surface border border-divider rounded-2xl px-4 py-4 mb-6">
          <Text
            className="text-text text-xs"
            style={{
              // RN doesn't have a monospace utility in nativewind — set the
              // platform-default monospace family inline.
              fontFamily: 'Menlo',
              lineHeight: 18,
            }}
          >
            {data.formula}
          </Text>
        </View>

        <Text className="text-text-subtle text-xs uppercase tracking-widest mb-2">Sources</Text>
        <View className="bg-surface border border-divider rounded-2xl overflow-hidden">
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
                <Text className="text-text-subtle text-xs mr-2 mt-0.5">•</Text>
                <View className="flex-1">
                  <Text
                    className="text-sm leading-5"
                    style={{ color: s.url ? colors.text : colors['text-muted'], textDecorationLine: s.url ? 'underline' : 'none' }}
                  >
                    {s.name}
                  </Text>
                  {s.url && (
                    <Text className="text-text-subtle text-xs mt-0.5" numberOfLines={1}>
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
