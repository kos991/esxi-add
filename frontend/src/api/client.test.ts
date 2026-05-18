import { describe, expect, it, vi } from 'vitest'

describe('api client', () => {
  it('adds the configured API token header', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_API_TOKEN', 'api-secret')

    const { default: api } = await import('./client')

    expect(api.defaults.headers.common['X-API-Token']).toBe('api-secret')
    vi.unstubAllEnvs()
  })
})
