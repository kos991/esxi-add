import * as Progress from '@radix-ui/react-progress'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { listBuckets } from '../api/buckets'
import { getBuild } from '../api/builds'
import { useWebSocket } from '../hooks/useWebSocket'
import { cn, formatBytes, formatDate, parseDrivers } from '../utils'

const statusClasses = {
  pending: 'bg-gray-100 text-gray-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const taskQuery = useQuery({ queryKey: ['build', taskId], queryFn: () => getBuild(taskId as string), enabled: Boolean(taskId), refetchInterval: 5000 })
  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const { logs, progress } = useWebSocket(taskId ?? null)
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  const task = taskQuery.data
  const bucket = useMemo(() => bucketsQuery.data?.find((item) => item.id === task?.storage_bucket_id), [bucketsQuery.data, task])
  const downloadUrl = task?.output_iso && bucket?.public_domain ? `${bucket.public_domain.replace(/\/$/, '')}/${bucket.bucket_name}/${task.output_iso}` : undefined
  const driverList = useMemo(() => parseDrivers(task?.drivers), [task?.drivers])
  const effectiveProgress = progress || task?.progress || 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Task Detail</h1>
        <p className="font-mono text-xs text-gray-500">{taskId}</p>
      </div>

      {taskQuery.isError && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{String(taskQuery.error)}</div>}
      {!task && taskQuery.isLoading && <div className="text-sm text-gray-500">Loading task...</div>}

      {task && (
        <>
          <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
            <div className="rounded-lg border bg-white p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-500">ESXi Version</div>
                  <div className="text-xl font-semibold">{task.esxi_version}</div>
                </div>
                <span className={cn('rounded-full px-3 py-1 text-sm font-medium', statusClasses[task.status])}>{task.status}</span>
              </div>
              <div className="space-y-3 text-sm">
                <div><span className="font-medium">Depot:</span> {task.depot_path}</div>
                <div>
                  <span className="font-medium">Drivers:</span>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
                    {driverList.map((driver) => <li key={driver}>{driver}</li>)}
                  </ul>
                </div>
                <div><span className="font-medium">Created:</span> {formatDate(task.created_at)}</div>
                <div><span className="font-medium">Started:</span> {formatDate(task.started_at)}</div>
                <div><span className="font-medium">Completed:</span> {formatDate(task.completed_at)}</div>
              </div>
              <div className="mt-6 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Progress</span>
                  <span>{effectiveProgress}%</span>
                </div>
                <Progress.Root value={effectiveProgress} className="relative h-3 overflow-hidden rounded-full bg-gray-100">
                  <Progress.Indicator className="h-full bg-blue-600 transition-all" style={{ width: `${effectiveProgress}%` }} />
                </Progress.Root>
              </div>
            </div>

            <div className="rounded-lg border bg-white p-6">
              <h2 className="mb-4 font-semibold">Output</h2>
              {task.status === 'completed' ? (
                <div className="space-y-3 text-sm">
                  <div><span className="font-medium">ISO:</span> {task.output_iso || '-'}</div>
                  <div><span className="font-medium">Size:</span> {formatBytes(task.output_iso_size)}</div>
                  <div><span className="font-medium">SHA256:</span> <span className="break-all font-mono text-xs">{task.output_iso_sha256}</span></div>
                  {downloadUrl && (
                    <a className="inline-flex rounded bg-blue-600 px-4 py-2 text-white" href={downloadUrl} target="_blank" rel="noreferrer">Download ISO</a>
                  )}
                </div>
              ) : task.status === 'failed' ? (
                <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{task.error_message || 'Build failed'}</div>
              ) : (
                <div className="text-sm text-gray-500">Build is still in progress.</div>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-white p-6">
            <h2 className="mb-4 font-semibold">Build Logs</h2>
            <div ref={logRef} className="h-96 overflow-y-auto rounded bg-gray-950 p-4 font-mono text-xs text-green-200">
              {(logs.length > 0 ? logs : (task.log_output?.split('\n').filter(Boolean) ?? [])).map((line, index) => (
                <div key={`${index}-${line}`}>{line}</div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
