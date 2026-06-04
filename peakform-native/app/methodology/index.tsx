import { View, Text, ScrollView, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { TOPICS } from '../../lib/methodology'

// Hub for "How is this calculated?" — lists each topic + a sources page.
// Reached from Settings → "How it works" row.

export default function MethodologyHubScreen() {
  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <View className="flex-row items-center px-4 pt-2 pb-4">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="-ml-1 pr-4 py-2 flex-row items-center" style={{ gap: 2 }}>
          <ChevronLeft size={22} color="#d4d4d8" strokeWidth={2.25} />
          <Text className="text-zinc-300 text-base font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold flex-1">How is this calculated?</Text>
      </View>

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
      >
        <Text className="text-zinc-500 text-sm leading-5 mb-6">
          The numbers in PeakForm are derived from data you log — not from wearable APIs or
          black-box scores. Here's exactly how each one is computed, with the published
          guidance we leaned on.
        </Text>

        <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden mb-3">
          {TOPICS.map((t, i) => (
            <TouchableOpacity
              key={t.slug}
              onPress={() => router.push(`/methodology/${t.slug}`)}
              className="px-4 py-3.5"
              style={{
                borderBottomWidth: i === TOPICS.length - 1 ? 0 : 1,
                borderBottomColor: '#27272a',
              }}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-white text-sm font-medium">{t.title}</Text>
                <Text className="text-zinc-500 text-base">›</Text>
              </View>
              <Text className="text-zinc-500 text-xs mt-1">{t.summary}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <TouchableOpacity
            onPress={() => router.push('/methodology/sources')}
            className="px-4 py-3.5"
          >
            <View className="flex-row items-center justify-between">
              <Text className="text-white text-sm font-medium">Sources &amp; references</Text>
              <Text className="text-zinc-500 text-base">›</Text>
            </View>
            <Text className="text-zinc-500 text-xs mt-1">
              Every paper and guideline cited above, in one place.
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
