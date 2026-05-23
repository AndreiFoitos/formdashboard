import { View, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { BottomNav } from '../components/BottomNav'

export default function AskScreen() {
  useRequireAuth()

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-white text-xl font-bold mb-2">Ask</Text>
        <Text className="text-zinc-500 text-sm text-center">
          AI coach coming soon
        </Text>
      </View>
      <BottomNav />
    </SafeAreaView>
  )
}