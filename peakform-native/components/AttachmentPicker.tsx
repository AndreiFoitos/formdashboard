import { Text, TouchableOpacity, View } from 'react-native'
import { ATTACHMENT_LABEL } from '../lib/exercises'
import { hapticLight } from '../lib/haptics'
import { colors } from '../theme/tokens'

// Cable attachment chips (rope, triangle, ...). A rope and a triangle
// pushdown are different lifts: each keeps its own weights, target and PR.
// Choice chips per DESIGN.md §4 (rounded-full, selected = white fill);
// hitSlop takes the 32 pt chip to 44 pt (§10, Phase 5). They wrap rather
// than scroll sideways, so they're safe inside tab pages (swipe lock, §10).

/** `null` in `options` is sets logged without an attachment. */
export function AttachmentPicker({
  options,
  value,
  onChange,
  deselectable = true,
  disabled = false,
}: {
  options: (string | null)[]
  value: string | null
  onChange: (attachment: string | null) => void
  /** Tapping the selected chip clears it (the log sheet: "no attachment"). */
  deselectable?: boolean
  disabled?: boolean
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((a) => {
        const active = a === value
        return (
          <TouchableOpacity
            key={a ?? 'none'}
            disabled={disabled}
            onPress={() => {
              if (active && !deselectable) return
              hapticLight()
              onChange(active ? null : a)
            }}
            hitSlop={{ top: 6, bottom: 6 }}
            className="rounded-full border px-3 py-2"
            style={{
              borderCurve: 'continuous',
              backgroundColor: active ? colors.text : colors['surface-raised'],
              borderColor: active ? colors.text : colors.border,
              opacity: disabled ? 0.4 : 1,
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              className="text-caption font-semibold"
              style={{ color: active ? colors.bg : colors['text-muted'] }}
            >
              {a ? ATTACHMENT_LABEL[a] ?? a : 'Not set'}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}
