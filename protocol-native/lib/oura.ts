import * as WebBrowser from 'expo-web-browser'
import { api } from '../api/client'

// The backend's OAuth callback redirects here to hand control back to the app.
// Must match OAUTH_APP_RETURN_URL on the server and the `scheme` in app.json.
const RETURN_URL = 'protocol://oura-callback'

export type OuraConnectResult = 'success' | 'error' | 'cancelled'

export async function connectOura(): Promise<OuraConnectResult> {
  // 1. Ask the backend for the authorize URL (it owns the client secret + state).
  const { data } = await api.get('/devices/connect/oura')

  // 2. Open Oura's consent screen; resolves when it redirects back to our scheme.
  const result = await WebBrowser.openAuthSessionAsync(data.authorize_url, RETURN_URL)
  if (result.type !== 'success' || !result.url) return 'cancelled'

  // 3. The backend already exchanged the code + backfilled before redirecting;
  //    the status query param just tells us how it went.
  return result.url.includes('status=success') ? 'success' : 'error'
}

export async function syncOura(): Promise<boolean> {
  try {
    const { data } = await api.post('/devices/sync/oura')
    return !!data.synced
  } catch {
    return false
  }
}
