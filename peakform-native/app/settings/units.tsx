import { ScrollView, Text } from 'react-native'
import { hapticLight } from '../../lib/haptics'
import { UNIT_SYSTEM_LABEL, useUnitsStore, type UnitSystem } from '../../lib/units'
import { SettingsGroup } from '../../components/settings/SettingsGroup'
import { SettingsRow } from '../../components/settings/SettingsRow'

const OPTIONS: { key: UnitSystem; detail: string }[] = [
  { key: 'metric', detail: 'kg, cm, ml' },
  { key: 'imperial', detail: 'lb, ft and in, fl oz' },
]

export default function UnitsScreen() {
  const system = useUnitsStore((s) => s.system)
  const setSystem = useUnitsStore((s) => s.setSystem)
  const saveError = useUnitsStore((s) => s.saveError)
  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} className="flex-1 bg-bg" contentContainerClassName="px-4 pt-4 pb-12" contentInsetAdjustmentBehavior="automatic">
      <SettingsGroup
        first
        footer={saveError ? <Text className="text-danger text-footnote">{saveError}</Text> : 'Food macros stay in grams in both systems.'}
      >
        {OPTIONS.map((o) => (
          <SettingsRow
            key={o.key}
            title={UNIT_SYSTEM_LABEL[o.key]}
            detail={o.detail}
            checked={system === o.key}
            onPress={() => {
              hapticLight()
              setSystem(o.key)
            }}
          />
        ))}
      </SettingsGroup>
    </ScrollView>
  )
}
