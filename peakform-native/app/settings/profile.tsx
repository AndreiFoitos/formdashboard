import { ScrollView } from 'react-native'
import { router } from 'expo-router'
import { useAuthStore } from '../../store/auth'
import { useUnits } from '../../lib/units'
import { SettingsGroup } from '../../components/settings/SettingsGroup'
import { SettingsRow } from '../../components/settings/SettingsRow'

// Settings → Profile (DESIGN.md §6). Age, sex and height used to be
// onboarding-only; changing them here offers to recompute the calorie target.

const SEX_LABEL = { male: 'Male', female: 'Female' } as const

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user)
  const u = useUnits()
  const edit = (field: string) => router.push({ pathname: '/settings/edit/[field]', params: { field } })

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
      className="flex-1 bg-bg"
      contentContainerClassName="px-4 pt-4 pb-12"
      contentInsetAdjustmentBehavior="automatic"
    >
      <SettingsGroup first footer="Friends invite you with your username.">
        <SettingsRow title="Username" value={user?.username ? `@${user.username}` : 'Not set'} onPress={() => edit('username')} />
      </SettingsGroup>

      <SettingsGroup header="Body" footer="Used for your calorie estimate and your avatar's proportions.">
        <SettingsRow title="Age" value={user?.age != null ? `${user.age}` : 'Not set'} onPress={() => edit('age')} />
        <SettingsRow
          title="Sex"
          value={user?.sex ? SEX_LABEL[user.sex] : 'Not set'}
          onPress={() => router.push({ pathname: '/settings/choose/[field]', params: { field: 'sex' } })}
        />
        <SettingsRow title="Height" value={user?.height_cm != null ? u.heightLabel(user.height_cm) : 'Not set'} onPress={() => edit('height')} />
      </SettingsGroup>

      <SettingsGroup header="Account">
        <SettingsRow title="Email" value={user?.email ?? '—'} />
      </SettingsGroup>
    </ScrollView>
  )
}
