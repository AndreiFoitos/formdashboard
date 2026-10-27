import { useCallback } from 'react'
import { Alert, ScrollView } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { extractErrorMessage } from '../../lib/apiError'
import { useUnits } from '../../lib/units'
import { SettingsGroup } from '../../components/settings/SettingsGroup'
import { SettingsRow } from '../../components/settings/SettingsRow'

// Settings → Profile (DESIGN.md §6). Age, sex and height used to be
// onboarding-only; changing them here offers to recompute the calorie target.

const SEX_LABEL = { male: 'Male', female: 'Female' } as const

// Setting and changing both go through an emailed link, so the password page
// opens in the browser and proves the person owns the email.
function requestPasswordLink(email: string | null, hasPassword: boolean) {
  const verb = hasPassword ? 'change' : 'set'
  if (!email) {
    return Alert.alert('Add an email first', `You need an email on your account to ${verb} a password.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add email', onPress: () => router.push('/settings/add-email') },
    ])
  }
  Alert.alert(`${hasPassword ? 'Change' : 'Set'} password`, `We'll email a link to ${email} to ${verb} your password.`, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Send link',
      onPress: () =>
        api
          .post('/auth/password/link')
          .then(() => Alert.alert('Check your email', `Open the link we sent to ${email}. It works for 1 hour.`))
          .catch((e) => Alert.alert("Couldn't send the link", extractErrorMessage(e, 'Try again in a minute.'))),
    },
  ])
}

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s) => s.updateUser)
  const u = useUnits()

  // The email and password are finished in the browser, so re-read the
  // account whenever this screen comes back into view.
  useFocusEffect(
    useCallback(() => {
      api.get('/users/me').then(({ data }) => updateUser(data)).catch(() => {})
    }, [updateUser]),
  )
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

      <SettingsGroup
        header="Account"
        footer={user?.has_password ? 'You can sign in with your email and password.' : 'Set a password to also sign in with your email.'}
      >
        {user?.email ? (
          <SettingsRow title="Email" value={user.email} />
        ) : (
          <SettingsRow title="Email" value="Add" onPress={() => router.push('/settings/add-email')} />
        )}
        <SettingsRow
          title="Password"
          value={user?.has_password ? 'Change' : 'Set'}
          onPress={() => requestPasswordLink(user?.email ?? null, !!user?.has_password)}
        />
      </SettingsGroup>
    </ScrollView>
  )
}
