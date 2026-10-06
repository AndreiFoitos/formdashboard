import { Icon, Label, NativeTabs, VectorIcon } from 'expo-router/unstable-native-tabs'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { colors } from '../../theme/tokens'

// The system tab bar (DESIGN.md §5): expo-router native tabs, SF Symbols on
// iOS with Material icons as the Android fallback (SDK 54 has no `md` prop).
// No swipe between tabs. OfflineBanner and PolicyUpdateNotice live in the
// root layout, above the tabs.

export default function TabsLayout() {
  return (
    <NativeTabs
      tintColor={colors.accent}
      labelStyle={{ default: { color: colors['text-subtle'] }, selected: { color: colors.accent } }}
      iconColor={{ default: colors['text-subtle'], selected: colors.accent }}
      backgroundColor={colors.surface}
      indicatorColor={colors['surface-raised']}
      rippleColor={colors['surface-raised']}
    >
      <NativeTabs.Trigger name="index">
        <Label>Today</Label>
        <Icon sf={{ default: 'house', selected: 'house.fill' }} androidSrc={<VectorIcon family={MaterialIcons} name="home" />} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="training">
        <Label>Training</Label>
        <Icon sf="dumbbell.fill" androidSrc={<VectorIcon family={MaterialIcons} name="fitness-center" />} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="nutrition">
        <Label>Nutrition</Label>
        <Icon sf="fork.knife" androidSrc={<VectorIcon family={MaterialIcons} name="restaurant" />} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="body">
        <Label>Body</Label>
        <Icon sf="figure" androidSrc={<VectorIcon family={MaterialIcons} name="accessibility-new" />} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="ask">
        <Label>Pit</Label>
        <Icon
          sf={{ default: 'bubble.left.and.text.bubble.right', selected: 'bubble.left.and.text.bubble.right.fill' }}
          androidSrc={<VectorIcon family={MaterialIcons} name="forum" />}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
