import axios from 'axios'

const api = axios.create({ baseURL: '/api' })
const apiToken = import.meta.env.VITE_API_TOKEN?.trim()

if (apiToken) {
  api.defaults.headers.common['X-API-Token'] = apiToken
}

api.interceptors.response.use(
  (r) => r.data,
  (e) => Promise.reject(e.response?.data?.error ?? e.message)
)

export default api
