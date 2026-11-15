import { useEffect, useRef, useState } from 'react'

export type WsState = 'idle' | 'connecting' | 'open' | 'closed'

/**
 * 订阅构建任务日志。断线后自动重连（指数退避），
 * 重连期间保留已收到的历史行，避免日志整段消失。
 */
export function useWebSocket(taskId: string | null) {
  const [logs, setLogs] = useState<string[]>([])
  const [progress, setProgress] = useState(0)
  const [state, setState] = useState<WsState>('idle')
  const closedByUs = useRef(false)

  useEffect(() => {
    setLogs([])
    setProgress(0)
    if (!taskId) {
      setState('idle')
      return
    }

    closedByUs.current = false
    let socket: WebSocket | null = null
    let retry = 0
    let timer: number | undefined

    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      const encodedTaskId = encodeURIComponent(taskId)
      const apiToken = import.meta.env.VITE_API_TOKEN?.trim()
      const tokenQuery = apiToken ? `?token=${encodeURIComponent(apiToken)}` : ''
      setState('connecting')
      socket = new WebSocket(`${protocol}://${location.host}/ws/builds/${encodedTaskId}${tokenQuery}`)

      socket.onopen = () => {
        retry = 0
        setState('open')
      }

      socket.onmessage = (e) => {
        let msg: any
        try {
          msg = JSON.parse(e.data)
        } catch {
          return
        }
        const content = msg.content ?? msg.message ?? ''
        const pct = Number(msg.progress ?? msg.percentage ?? 0)

        if (msg.type === 'log') setLogs((prev) => [...prev, String(content)])
        else if (msg.type === 'history') setLogs(String(content).split('\n').filter(Boolean))
        else if (msg.type === 'progress' && Number.isFinite(pct)) setProgress(pct)
      }

      socket.onclose = () => {
        setState('closed')
        if (closedByUs.current) return
        retry += 1
        const delay = Math.min(15000, 800 * 2 ** (retry - 1))
        timer = window.setTimeout(connect, delay)
      }

      socket.onerror = () => {
        socket?.close()
      }
    }

    connect()

    return () => {
      closedByUs.current = true
      if (timer) window.clearTimeout(timer)
      socket?.close()
    }
  }, [taskId])

  return { logs, progress, state }
}
