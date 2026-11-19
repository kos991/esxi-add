import axios from 'axios'

export const ADMIN_TOKEN_STORAGE_KEY = 'esxi_admin_token'
export const ADMIN_UNAUTHORIZED_EVENT = 'esxi:admin-unauthorized'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})
const apiToken = import.meta.env.VITE_API_TOKEN?.trim()

if (apiToken) {
  api.defaults.headers.common['X-API-Token'] = apiToken
}

export function getStoredAdminToken(): string {
  try {
    return window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function setStoredAdminToken(token: string | null) {
  try {
    if (token && token.trim()) {
      window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token.trim())
    } else {
      window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
    }
  } catch {
    // ignore storage errors in restricted environments
  }
}

api.interceptors.request.use((config) => {
  const adminToken = getStoredAdminToken()
  if (adminToken) {
    config.headers = config.headers ?? {}
    config.headers['X-Admin-Token'] = adminToken
  }
  return config
})

api.interceptors.response.use(
  (r) => r.data,
  (e) => {
    const code = e.response?.data?.code
    if (e.response?.status === 401 && (code === 'admin_auth_required' || code === 'admin_setup_required')) {
      setStoredAdminToken(null)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(ADMIN_UNAUTHORIZED_EVENT, { detail: { code } }))
      }
    }
    return Promise.reject(e.response?.data?.error ?? e.message)
  }
)

export default api
