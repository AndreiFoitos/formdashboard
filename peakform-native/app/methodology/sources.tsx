import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
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
      <View className="flex-row items-center px-4 pt-2 pb-4">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="-ml-1 pr-4 py-2 flex-row items-center" style={{ gap: 2 }}>
          <ChevronLeft size={22} color={colors.text} strokeWidth={2.25} />
          <Text className="text-text-muted text-base font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-text text-xl font-bold flex-1">Sources &amp; references</Text>
      </View>

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
      >
        <Text className="text-text-subtle text-sm leading-5 mb-5">
          Every paper, guideline, and reference cited in the methodology pages.
        </Text>

        <View className="bg-surface border border-divider rounded-2xl overflow-hidden">
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
