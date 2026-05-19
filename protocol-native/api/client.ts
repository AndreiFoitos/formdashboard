import axios from 'axios'
  failedQueue.forEach((p) => {
    if (token) {
      p.resolve(token)
    } else {
      p.reject(error)
    }
  })

  failedQueue = []
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config

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

      if (!refreshToken) {
        throw new Error('No refresh token')
      }

      const { data } = await axios.post(
        'http://YOUR_BACKEND_IP:8000/auth/refresh',
        {
          refresh_token: refreshToken,
        }
      )

      const newAccessToken = data.access_token

      await setToken('refresh_token', data.refresh_token)

      const { user, setAuth } = useAuthStore.getState()

      if (user) {
        setAuth(user, newAccessToken)
      }

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
  }
)