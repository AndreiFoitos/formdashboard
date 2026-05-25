import type { ComponentType } from 'react'
import Svg, { Path, Circle, Line } from 'react-native-svg'

type IconProps = { color: string; size?: number }

const STROKE = 2

export function TodayIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={4} stroke={color} strokeWidth={STROKE} />
      {[
        [12, 2, 12, 4],
        [12, 20, 12, 22],
        [2, 12, 4, 12],
        [20, 12, 22, 12],
        [4.9, 4.9, 6.3, 6.3],
        [17.7, 17.7, 19.1, 19.1],
        [4.9, 19.1, 6.3, 17.7],
        [17.7, 6.3, 19.1, 4.9],
      ].map(([x1, y1, x2, y2], i) => (
        <Line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
      ))}
    </Svg>
  )
}

export function TrainingIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6.5 6.5 L17.5 17.5 M5 8 L8 5 M16 19 L19 16 M3.5 6.5 L6.5 3.5 M17.5 20.5 L20.5 17.5 M9 15 L15 9"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function NutritionIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 7c-1-2.5-3.5-3-5-1.8C5 7 5.2 11 7 14c1 1.7 2.2 4 4 4s2.5-1.5 3.8-3.2C17 12 18 8 16 5.2 14.6 3.4 12.8 4.2 12 7Z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <Path
        d="M12 7c0-2 1-3.5 3-4"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </Svg>
  )
}

export function BodyIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 17 L8.5 11 L12 14 L20 5"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M20 9 V5 H16"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function AskIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <Circle cx={8.5} cy={11} r={1} fill={color} />
      <Circle cx={12} cy={11} r={1} fill={color} />
      <Circle cx={15.5} cy={11} r={1} fill={color} />
    </Svg>
  )
}

export const TAB_ICONS: Record<string, ComponentType<IconProps>> = {
  index: TodayIcon,
  training: TrainingIcon,
  nutrition: NutritionIcon,
  body: BodyIcon,
  ask: AskIcon,
}
