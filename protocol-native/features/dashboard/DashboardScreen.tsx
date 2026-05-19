import { View, Text, ScrollView } from 'react-native'
import { useQuery } from '@tanstack/react-query'

import { api } from '../../api/client'
import { BottomNav } from '../../components/BottomNav'
import { CaffeineCurve } from '../../components/CaffeineCurve'

function getGreeting() {
  const h = new Date().getHours()

  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'

  return 'Good evening'
}

export default function DashboardScreen() {
  const { data } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await api.get('/dashboard')
      return res.data
    },
  })

  return (
    <View className="flex-1 bg-black">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: 80,
          paddingHorizontal: 16,
          paddingBottom: 140,
        }}
      >
        <Text className="text-zinc-500 text-xs uppercase tracking-widest mb-2">
          Today
        </Text>

        <Text className="text-white text-3xl font-bold mb-6">
          {getGreeting()}
        </Text>

        <View className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 mb-4">
          <Text className="text-zinc-500 text-xs uppercase mb-2">
            Water
          </Text>

          <Text className="text-white text-2xl font-bold">
            {data?.summary?.water_ml ?? 0}ml
          </Text>
        </View>

        <CaffeineCurve
          data={data?.caffeine}
          isLoading={false}
        />
      </ScrollView>

      <BottomNav />
    </View>
  )
}