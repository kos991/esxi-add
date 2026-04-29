import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.response.use(
  (r) => r.data,
  (e) => Promise.reject(e.response?.data?.error ?? e.message)
)

export default api
