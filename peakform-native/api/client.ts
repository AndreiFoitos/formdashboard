import axios from 'axios'
import { getToken, setToken, removeToken } from '../lib/storage'
import { useAuthStore } from '../store/auth'

// ── Base URL ──────────────────────────────────────────────────────────────────
// Resolved at build time from EXPO_PUBLIC_API_URL (set per build profile in
// eas.json). The fallback only ever applies when running `expo start` on a dev
// machine without the env var set — in that case use your LAN IP so a physical
// device on the same Wi-Fi can reach the backend. `localhost` works only in
// simulators. Production / TestFlight builds always have EXPO_PUBLIC_API_URL
// baked in by EAS, so the fallback never ships to users.
const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.178.240:8000'

export const api = axios.create({
  baseURL: BASE_URL,
})

// ── Attach access token to every outgoing request ────────────────────────────
// useAuthStore.getState() is fine here — we're calling it inside a
// callback, not at the top level of a component, so no hook rules apply.
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── Silent token refresh on 401 ───────────────────────────────────────────────
let isRefreshing = false
let failedQueue: Array<{
  resolve: (token: string) => void
  reject: (err: unknown) => void
}> = []

function processQueue(token: string | null, error: unknown = null) {
  failedQueue.forEach((p) => (token ? p.resolve(token) : p.reject(error)))
  failedQueue = []
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config as typeof err.config & { _retry?: boolean }

    if (err.response?.status !== 401 || original._retry) {
      return Promise.reject(err)
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((token) => {
        original.headers = original.headers ?? {}
        original.headers.Authorization = `Bearer ${token}`
        return api(original)
      })
    }

    original._retry = true
    isRefreshing = true

    try {
      const refreshToken = await getToken('refresh_token')
      if (!refreshToken) throw new Error('No refresh token')

      const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
        refresh_token: refreshToken,
      })

      const newAccessToken: string = data.access_token
      await setToken('refresh_token', data.refresh_token)

      const { user, setAuth } = useAuthStore.getState()
      if (user) setAuth(user, newAccessToken)

      processQueue(newAccessToken)
      original.headers = original.headers ?? {}
      original.headers.Authorization = `Bearer ${newAccessToken}`
      return api(original)
    } catch (refreshError) {
      processQueue(null, refreshError)
      await removeToken('refresh_token')
      useAuthStore.getState().clearAuth()
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  },
)