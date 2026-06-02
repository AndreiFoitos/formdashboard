import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg'

// `color` is accepted for API parity with Lucide icons but ignored — the
// gradient takes precedence by design.
type Props = { size?: number; color?: string }

export function SusFace({ size = 16 }: Props) {
  const gid = 'susFaceGradient'
  const features = '#1E1B4B'
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#EC4899" />
          <Stop offset="1" stopColor="#8B5CF6" />
        </LinearGradient>
      </Defs>
      <Circle cx="12" cy="12" r="10" fill={`url(#${gid})`} />
      <Path
        d="M5.5 8.5 Q 7.5 6.3, 9.5 8.2"
        stroke={features}
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M14.5 9.2 L 18.5 8.5"
        stroke={features}
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M6.2 11.7 Q 7.6 12.6, 9 11.7"
        stroke={features}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <Circle cx="16.5" cy="11.6" r="1.25" fill={features} />
      <Path
        d="M9 16 L 15.2 16"
        stroke={features}
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  )
}
