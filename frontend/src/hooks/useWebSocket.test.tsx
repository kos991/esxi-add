import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWebSocket } from './useWebSocket'

describe('useWebSocket', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('adds the configured API token to the WebSocket URL', () => {
    vi.stubEnv('VITE_API_TOKEN', 'api secret/?')
    const webSocket = vi.fn(function (this: { close: () => void }) {
      this.close = vi.fn()
    })
    vi.stubGlobal('WebSocket', webSocket)

    renderHook(() => useWebSocket('task/1'))

    expect(webSocket).toHaveBeenCalledWith(
      expect.stringContaining('/ws/builds/task%2F1?token=api%20secret%2F%3F'),
    )
  })
})
