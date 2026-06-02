import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg'

// `color` is accepted for API parity with Lucide icons but ignored — the
// gradient takes precedence by design.
type Props = { size?: number; color?: string }

export function TrustedShield({ size = 16 }: Props) {
  const gid = 'trustedShieldGradient'
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FEF3C7" />
          <Stop offset="1" stopColor="#D4A574" />
        </LinearGradient>
      </Defs>
      <Path
        d="M12 2C8.5 2 5.5 2.8 3.5 3.8L3.5 11.5C3.5 16.5 7 20.5 12 22C17 20.5 20.5 16.5 20.5 11.5L20.5 3.8C18.5 2.8 15.5 2 12 2Z"
        fill={`url(#${gid})`}
      />
      <Path
        d="M7 12.8C6.6 13.1 6.7 13.7 7.05 14.05L9.5 16.5C10.05 17.05 10.95 17 11.45 16.4L17.2 9.2C17.7 8.55 17.45 7.65 16.7 7.4C16.15 7.2 15.55 7.4 15.2 7.85L10.55 13.7C10.4 13.9 10.1 13.9 9.95 13.7L8.35 11.95C7.9 11.45 7.45 11.5 7 12.8Z"
        fill="#7A4A0A"
        opacity={0.85}
      />
    </Svg>
  )
}
