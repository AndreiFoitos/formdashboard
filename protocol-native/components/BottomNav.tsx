import { View, TouchableOpacity, Text } from 'react-native'
import { router, usePathname } from 'expo-router'

const items = [
  {
    path: '/',
    label: 'Today',
  },
  {
    path: '/training',
    label: 'Training',
  },
  {
    path: '/nutrition',
    label: 'Nutrition',
  },
  {
    path: '/body',
    label: 'Body',
  },
  {
    path: '/ask',
    label: 'Ask',
  },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <View className="absolute bottom-0 left-0 right-0 bg-zinc-950 border-t border-zinc-900 flex-row py-4 px-2">
      {items.map((item) => {
        const active = pathname === item.path

        return (
          <TouchableOpacity
            key={item.path}
            onPress={() => router.push(item.path as any)}
            className="flex-1 items-center"
          >
            <Text
              className={active ? 'text-white text-xs' : 'text-zinc-600 text-xs'}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}