import { View, Text } from 'react-native'
import { AreaChart, Grid } from 'react-native-svg-charts'
import * as shape from 'd3-shape'

interface CurvePoint {
  caffeine_mg: number
}

interface CurveData {
  curve: CurvePoint[]
  current_mg: number
  sleep_impact: string
}

interface Props {
  data: CurveData
  isLoading: boolean
}

export function CaffeineCurve({ data }: Props) {
  const values = data?.curve?.map((p) => p.caffeine_mg) ?? []

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
      <Text className="text-zinc-500 text-xs uppercase mb-2">
        Caffeine
      </Text>

      <Text className="text-white text-3xl font-bold mb-4">
        {data?.current_mg ?? 0}mg
      </Text>

      <AreaChart
        style={{ height: 140 }}
        data={values}
        svg={{ fill: 'rgba(255,255,255,0.15)', stroke: 'white' }}
        contentInset={{ top: 20, bottom: 20 }}
        curve={shape.curveNatural}
      >
        <Grid />
      </AreaChart>

      <Text className="text-zinc-500 text-xs mt-4 leading-5">
        {data?.sleep_impact}
      </Text>
    </View>
  )
}