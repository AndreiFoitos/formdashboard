import { View, Text, ScrollView, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { TOPICS } from '../../lib/methodology'
import { colors } from '../../theme/tokens'

// Hub for "How is this calculated?" — lists each topic + a sources page.
// Reached from Settings → "How it works" row.

export default function MethodologyHubScreen() {
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView
        className="flex-1 px-4"
        contentContainerClassName="pt-1 pb-12"
      >
        <Text className="text-text-subtle text-footnote mb-6">
          The numbers in GainRace are derived from data you log — not from wearable APIs or
          black-box scores. Here's exactly how each one is computed, with the published
          guidance we leaned on.
        </Text>

        <View className="bg-surface border border-divider rounded-xl overflow-hidden mb-3" style={{ borderCurve: 'continuous' }}>
          {TOPICS.map((t, i) => (
            <TouchableOpacity
              key={t.slug}
              onPress={() => router.push(`/methodology/${t.slug}`)}
              className="px-4 py-4"
              style={{
                borderBottomWidth: i === TOPICS.length - 1 ? 0 : 1,
                borderBottomColor: colors.divider,
              }}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-text text-footnote font-medium">{t.title}</Text>
                <Text className="text-text-subtle text-body">›</Text>
              </View>
              <Text className="text-text-subtle text-caption mt-1">{t.summary}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View className="bg-surface border border-divider rounded-xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
          <TouchableOpacity
            onPress={() => router.push('/methodology/sources')}
            className="px-4 py-4"
          >
            <View className="flex-row items-center justify-between">
              <Text className="text-text text-footnote font-medium">Sources &amp; references</Text>
              <Text className="text-text-subtle text-body">›</Text>
            </View>
            <Text className="text-text-subtle text-caption mt-1">
              Every paper and guideline cited above, in one place.
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
