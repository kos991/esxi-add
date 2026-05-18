import { useEffect, useState } from 'react'

export function useWebSocket(taskId: string | null) {
  const [logs, setLogs] = useState<string[]>([])
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    setLogs([])
    setProgress(0)
    if (!taskId) return

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const encodedTaskId = encodeURIComponent(taskId)
    const apiToken = import.meta.env.VITE_API_TOKEN?.trim()
    const tokenQuery = apiToken ? `?token=${encodeURIComponent(apiToken)}` : ''
    const ws = new WebSocket(`${protocol}://${location.host}/ws/builds/${encodedTaskId}${tokenQuery}`)

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      const content = msg.content ?? msg.message ?? ''
      const pct = msg.progress ?? msg.percentage ?? 0

      if (msg.type === 'log') setLogs((prev) => [...prev, content])
      else if (msg.type === 'history') setLogs(String(content).split('\n').filter(Boolean))
      else if (msg.type === 'progress') setProgress(Number(pct) || 0)
    }

    return () => { ws.close() }
  }, [taskId])

  return { logs, progress }
}
