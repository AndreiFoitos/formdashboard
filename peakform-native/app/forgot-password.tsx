import { useLocalSearchParams } from 'expo-router'
import { api } from '../api/client'
import { EmailLinkForm } from '../components/account/EmailLinkForm'

export default function ForgotPasswordScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>()
  return (
    <EmailLinkForm
      title="Reset password"
      intro="Enter your account's email and we'll send a link to set a new password. This also works if you signed up with Apple or Google."
      initialEmail={email ?? ''}
      sentNote={(to) => `If ${to} has a GainRace account, a link to set a new password is on its way. It works for 1 hour.`}
      send={(to) => api.post('/auth/password/forgot', { email: to })}
    />
  )
}
