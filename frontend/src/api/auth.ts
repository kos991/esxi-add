import api, { setStoredAdminToken } from './client'

export interface AuthStatus {
  version: string
  configured: boolean
  authenticated: boolean
  env_managed: boolean
}

export interface AuthSessionResponse extends AuthStatus {
  token?: string
  expires_at?: string
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const response = await api.get('/auth/status')
  return response.data
}

export async function setupAdminPassword(password: string): Promise<AuthSessionResponse> {
  const response = await api.post('/auth/setup', { password })
  const data = response.data as AuthSessionResponse
  if (data.token) {
    setStoredAdminToken(data.token)
  }
  return data
}

export async function loginAdmin(password: string): Promise<AuthSessionResponse> {
  const response = await api.post('/auth/login', { password })
  const data = response.data as AuthSessionResponse
  if (data.token) {
    setStoredAdminToken(data.token)
  }
  return data
}

export async function logoutAdmin(): Promise<AuthStatus> {
  try {
    const response = await api.post('/auth/logout')
    return response.data
  } finally {
    setStoredAdminToken(null)
  }
}

export async function changeAdminPassword(
  currentPassword: string,
  newPassword: string
): Promise<AuthSessionResponse> {
  const response = await api.put('/auth/password', {
    current_password: currentPassword,
    new_password: newPassword,
  })
  const data = response.data as AuthSessionResponse
  if (data.token) {
    setStoredAdminToken(data.token)
  }
  return data
}
