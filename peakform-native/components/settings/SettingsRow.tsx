import type { ReactNode } from 'react'
import { ActivityIndicator, Switch, Text, TouchableOpacity, View } from 'react-native'
import { Check, ChevronRight } from 'lucide-react-native'
import { colors } from '../../theme/tokens'

// One row of a SettingsGroup (DESIGN.md §6). Variants:
//   chevron      — onPress drills down (default when onPress is set)
//   value        — `value` shown in text-muted on the right
//   switch       — `switchValue` + `onSwitch`, native Switch, no chevron
//   destructive  — danger-colored title, no chevron
//   checked      — checkmark for pick-one lists

export const switchTrack = { false: colors.border, true: colors.accent }

export function SettingsRow({
  title,
  detail,
  value,
  leading,
  onPress,
  chevron,
  switchValue,
  onSwitch,
  destructive,
  checked,
  loading,
  disabled,
}: {
  title: string
  /** Second line under the title (text-footnote). */
  detail?: string
  value?: string
  leading?: ReactNode
  onPress?: () => void
  chevron?: boolean
  switchValue?: boolean
  onSwitch?: (v: boolean) => void
  destructive?: boolean
  checked?: boolean
  loading?: boolean
  disabled?: boolean
}) {
  const isSwitch = onSwitch != null
  const showChevron = chevron ?? (!!onPress && !isSwitch && !destructive && checked == null)

  const body = (
    <View className="flex-row items-center px-4 py-3 gap-3" style={{ minHeight: 44, opacity: disabled ? 0.4 : 1 }}>
      {leading}
      <View className="flex-1">
        <Text className={`text-body ${destructive ? 'text-danger' : 'text-text'}`}>{title}</Text>
        {detail && <Text className="text-text-subtle text-footnote mt-1">{detail}</Text>}
      </View>
      {value != null && (
        <Text className="text-text-muted text-body" numberOfLines={1}>
          {value}
        </Text>
      )}
      {loading ? (
        <ActivityIndicator color={colors['text-subtle']} />
      ) : isSwitch ? (
        <Switch
          value={!!switchValue}
          onValueChange={onSwitch}
          disabled={disabled}
          trackColor={switchTrack}
          thumbColor={colors.text}
          ios_backgroundColor={colors.border}
        />
      ) : checked ? (
        <Check size={20} color={colors.accent} strokeWidth={2.5} />
      ) : showChevron ? (
        <ChevronRight size={18} color={colors['text-subtle']} />
      ) : null}
    </View>
  )

  if (!onPress || isSwitch) return body
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled || loading} activeOpacity={0.6}>
      {body}
    </TouchableOpacity>
  )
}
