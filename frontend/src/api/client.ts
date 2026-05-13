import axios from 'axios'
import { useAuthStore } from '../store/auth'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
})

// Attach access token to every outgoing request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Silent refresh on 401 — queue concurrent requests while refreshing
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
      // Queue this request until the refresh completes
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`
        return api(original)
      })
    }

    original._retry = true
    isRefreshing = true

    try {
      const refreshToken = localStorage.getItem('refresh_token')
      if (!refreshToken) throw new Error('No refresh token')

      const { data } = await axios.post(
        `${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}/auth/refresh`,
        { refresh_token: refreshToken },
      )

      const newAccessToken: string = data.access_token
      localStorage.setItem('refresh_token', data.refresh_token)

      const { user, setAuth } = useAuthStore.getState()
      if (user) setAuth(user, newAccessToken)

      processQueue(newAccessToken)
      original.headers.Authorization = `Bearer ${newAccessToken}`
      return api(original)
    } catch (refreshError) {
      processQueue(null, refreshError)
      useAuthStore.getState().clearAuth()
      window.location.href = '/login'
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  },
)