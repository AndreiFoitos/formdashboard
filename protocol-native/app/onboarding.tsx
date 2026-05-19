import { View, Text } from 'react-native'

export default function OnboardingScreen() {
  return (
    <View className="flex-1 bg-black justify-center items-center px-6">
      <Text className="text-white text-3xl font-bold mb-4">
        Onboarding
      </Text>

      <Text className="text-zinc-500 text-center">
        Port your onboarding flow here step-by-step.
      </Text>
    </View>
  )
}