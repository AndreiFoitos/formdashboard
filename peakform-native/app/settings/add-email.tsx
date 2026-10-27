import { api } from '../../api/client'
import { EmailLinkForm } from '../../components/account/EmailLinkForm'

// Apple can sign someone in without sharing an email. This adds one; the
// backend saves it only once the emailed link is confirmed.

export default function AddEmailScreen() {
  return (
    <EmailLinkForm
      title="Add email"
      intro="Your account has no email yet. Add one to set a password and sign in with email. We'll send a link to confirm it."
      sentNote={(email) => `We sent a link to ${email}. Tap it to add the email to your account, then come back here.`}
      send={(email) => api.post('/users/me/email', { email })}
    />
  )
}
