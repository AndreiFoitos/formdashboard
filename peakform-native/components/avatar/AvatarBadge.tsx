import { useMemo } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { useAuthStore } from '../../store/auth'
import { useMyAvatar } from '../../hooks/useMyAvatar'
import { NO_EFFECTS, toState } from '../../lib/avatar/config'
import { extrasFor, frameColor } from '../../lib/avatar/rewards'
import type { DailyEffects } from '../../lib/avatar/bodyParams'
import { AvatarCanvas } from './AvatarCanvas'

const NO_COMBOS: string[] = []

/**
 * Round avatar face for headers, showing today's effects (pump / hydration
 * glow / caffeine jitter / combo effects). Static single frame unless an
 * effect needs motion.
 */
export function AvatarBadge({
  size = 44,
  effects = NO_EFFECTS,
  todayCombos = NO_COMBOS,
  champion = false,
  onPress,
}: {
  size?: number
  effects?: DailyEffects
  /** Combo ids active today (backend, rarest first) — adds their signature effect. */
  todayCombos?: string[]
  /** Won last week's race — shows a crown until the week ends. */
  champion?: boolean
  onPress?: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const { base, config, body } = useMyAvatar()
  const extras = useMemo(() => extrasFor(todayCombos, config.equipped), [todayCombos, config.equipped])
  const state = useMemo(() => toState(config.look, body, effects, extras), [config.look, body, effects, extras])
  const initial = (user?.name ?? user?.username ?? '?').trim().charAt(0).toUpperCase()

  // An equipped frame wins; otherwise the ring hints at today's state.
  const ring = frameColor(config.equipped?.frame) ?? (effects.glow ? '#22c55e' : effects.pump ? '#f59e0b' : '#3f3f46')
  const goldFrame = !!config.equipped?.frame?.endsWith('_gold')

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={body.levelUpAvailable ? 'Your avatar, level up available' : 'Your avatar'}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          backgroundColor: '#27272a',
          borderWidth: goldFrame ? 3 : 2,
          borderColor: ring,
        }}
      >
        <AvatarCanvas
          base={base}
          state={state}
          framing="head"
          animate={effects.jitter > 0}
          interactive={false}
          style={{ flex: 1 }}
          errorFallback={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#d4d4d8', fontWeight: '700', fontSize: size * 0.4 }}>{initial}</Text>
            </View>
          }
        />
      </View>
      {champion && (
        <Text
          pointerEvents="none"
          accessibilityLabel="Weekly race champion"
          style={{ position: 'absolute', top: -Math.round(size * 0.32), alignSelf: 'center', fontSize: Math.round(size * 0.42) }}
        >
          👑
        </Text>
      )}
      {body.levelUpAvailable && (
        <View
          style={{
            position: 'absolute',
            right: -2,
            top: -2,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: 4,
            backgroundColor: '#22c55e',
            borderWidth: 2,
            borderColor: '#000',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#000', fontSize: 10, fontWeight: '800' }}>↑</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}
