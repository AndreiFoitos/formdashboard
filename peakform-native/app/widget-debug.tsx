// Widget snapshot — dev builds only. Shows the JSON the home screen widgets
// read (docs/widgets-design.md §6), so the data can be checked without a
// native build: "Next write" is built in JS and works in any build; "Stored"
// needs the widget-bridge native module.

import { useCallback, useState } from 'react'
import { Platform, ScrollView, Share, Text, View } from 'react-native'
import { Redirect } from 'expo-router'
import { debugSnapshot, scheduleWidgetWrite } from '../lib/widgets'
import { SettingsGroup } from '../components/settings/SettingsGroup'
import { SettingsRow } from '../components/settings/SettingsRow'

/** Dev builds only (DESIGN.md §5 Cleanup): production has no route to it, and a
 *  deep link lands on Today. */
export default function WidgetDebugRoute() {
  if (!__DEV__) return <Redirect href="/" />
  return <WidgetDebug />
}

function pretty(json: string | null): string {
  if (!json) return 'Nothing stored'
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return `Not valid JSON:\n${json}`
  }
}

function WidgetDebug() {
  const [snap, setSnap] = useState(debugSnapshot)
  const refresh = useCallback(() => setSnap(debugSnapshot()), [])

  const stored = snap.nativeAvailable ? pretty(snap.native) : 'Native module not in this build'
  const next = JSON.stringify(snap.pending, null, 2)

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      className="flex-1 bg-bg"
      contentContainerClassName="px-4 pt-4 pb-12"
      contentInsetAdjustmentBehavior="automatic"
    >
      <SettingsGroup first>
        <SettingsRow title="Refresh" chevron={false} onPress={refresh} />
        <SettingsRow
          title="Write now"
          detail="Writes the next snapshot (after the 500 ms debounce)"
          chevron={false}
          onPress={() => {
            scheduleWidgetWrite()
            setTimeout(refresh, 700)
          }}
        />
        <SettingsRow title="Share stored JSON" chevron={false} onPress={() => Share.share({ message: stored })} />
      </SettingsGroup>

      <JsonBlock title="Stored (what the widget reads)" body={stored} />
      <JsonBlock title="Next write (built from the current cache)" body={next} />
    </ScrollView>
  )
}

function JsonBlock({ title, body }: { title: string; body: string }) {
  return (
    <View className="mt-6">
      <Text className="text-text-subtle text-footnote mb-2 px-4">{title}</Text>
      <View className="bg-surface rounded-xl p-4" style={{ borderCurve: 'continuous' }}>
        <Text
          selectable
          className="text-text-muted text-caption"
          style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}
        >
          {body}
        </Text>
      </View>
    </View>
  )
}
