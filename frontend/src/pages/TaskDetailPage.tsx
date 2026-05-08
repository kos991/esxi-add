import * as Progress from '@radix-ui/react-progress'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, Copy, Download, Search, Terminal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listBuckets } from '../api/buckets'
import { getBuild, getBuildArtifactUrl } from '../api/builds'
import { useWebSocket } from '../hooks/useWebSocket'
import { cn, formatBytes, formatDate, parseDrivers } from '../utils'

const statusClasses = {
  pending: 'border-gray-200 bg-gray-100 text-gray-700',
  running: 'border-blue-200 bg-blue-50 text-blue-700',
  completed: 'border-green-200 bg-green-50 text-green-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
}

function LogLine({ line }: { line: string }) {
  const isError = line.includes('[ERROR]') || line.toLowerCase().includes('failed')
  const isWarn = line.includes('[WARN]') || line.toLowerCase().includes('warning')
  const isInfo = line.includes('[INFO]')

  return (
    <div
      className={cn(
        'break-all px-2 py-0.5 whitespace-pre-wrap transition-colors hover:bg-gray-900',
        isError && 'bg-red-950/20 text-red-400',
        isWarn && 'bg-orange-950/20 text-orange-300',
        isInfo && 'text-blue-300'
      )}
    >
      {line}
    </div>
  )
}

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const taskQuery = useQuery({ queryKey: ['build', taskId], queryFn: () => getBuild(taskId as string), enabled: Boolean(taskId), refetchInterval: 5000 })
  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const { logs: wsLogs, progress } = useWebSocket(taskId ?? null)
  const logRef = useRef<HTMLDivElement | null>(null)

  const [logFilter, setLogFilter] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)

  const allLogs = useMemo(() => {
    if (wsLogs.length > 0) return wsLogs
    return taskQuery.data?.log_output?.split('\n').filter(Boolean) ?? []
  }, [wsLogs, taskQuery.data?.log_output])

  const filteredLogs = useMemo(() => {
    if (!logFilter) return allLogs
    return allLogs.filter((line) => line.toLowerCase().includes(logFilter.toLowerCase()))
  }, [allLogs, logFilter])

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [filteredLogs, autoScroll])

  const task = taskQuery.data
  const bucket = useMemo(() => bucketsQuery.data?.find((item) => item.id === task?.storage_bucket_id), [bucketsQuery.data, task])
  const publicDownloadUrl = task?.output_iso && bucket?.public_domain ? `${bucket.public_domain.replace(/\/$/, '')}/${bucket.bucket_name}/${task.output_iso}` : undefined
  const artifactDownloadUrl = task?.output_iso && task?.task_id ? getBuildArtifactUrl(task.task_id) : undefined
  const downloadUrl = publicDownloadUrl || artifactDownloadUrl
  const driverList = useMemo(() => parseDrivers(task?.drivers), [task?.drivers])
  const effectiveProgress = progress || task?.progress || 0

  const handleDownloadLogs = () => {
    const blob = new Blob([allLogs.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `build-${taskId}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyArtifactLink = async () => {
    if (!downloadUrl) return
    try {
      await navigator.clipboard.writeText(downloadUrl)
      setCopyMessage('Download link copied')
    } catch (error) {
      setCopyMessage(String(error))
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[12px] font-medium text-blue-700">Builds / Task Detail</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-950">Task Monitor</h1>
          <p className="mt-1 font-mono text-[12px] text-gray-500">{taskId}</p>
        </div>
        {task?.status === 'completed' && task.output_iso && downloadUrl && (
          <a href={downloadUrl} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-2 rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
            <Download className="h-4 w-4" />
            Download ISO
          </a>
        )}
      </div>

      {taskQuery.isError && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{String(taskQuery.error)}</div>}
      {copyMessage && <div className="rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">{copyMessage}</div>}

      {task && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <div className="rounded border border-l-4 border-l-blue-700 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-blue-50 text-blue-700">
                    <Terminal className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">ESXi Target</div>
                    <div className="text-lg font-bold text-gray-950">Version {task.esxi_version}</div>
                  </div>
                </div>
                <span className={cn('inline-flex rounded border px-2 py-0.5 text-[10px] font-bold uppercase', statusClasses[task.status])}>{task.status}</span>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-[12px] font-bold">
                  <span className="uppercase tracking-wider text-gray-500">Overall progress</span>
                  <span className="text-blue-700">{effectiveProgress}%</span>
                </div>
                <Progress.Root value={effectiveProgress} className="relative h-2 overflow-hidden rounded-full bg-gray-100">
                  <Progress.Indicator className="h-full bg-blue-700 transition-all duration-500" style={{ width: `${effectiveProgress}%` }} />
                </Progress.Root>
              </div>

              <div className="mt-5 grid gap-4 text-sm md:grid-cols-2">
                <InfoBlock label="Depot file" value={task.depot_path} mono />
                <div>
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">Injected drivers</div>
                  <div className="flex flex-wrap gap-1">
                    {driverList.length > 0 ? (
                      driverList.map((driver) => (
                        <span key={driver} className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                          {driver.split('/').pop()}
                        </span>
                      ))
                    ) : (
                      <span className="text-[12px] text-gray-500">No drivers selected</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex h-[560px] flex-col overflow-hidden rounded border bg-white shadow-sm">
              <div className="flex items-center justify-between gap-4 border-b bg-gray-50 px-4 py-3">
                <div className="flex flex-1 items-center gap-2">
                  <Search className="h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Filter logs..."
                    className="w-full border-none bg-transparent text-sm outline-none"
                    value={logFilter}
                    onChange={(e) => setLogFilter(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-gray-500">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                      className="h-3 w-3 rounded border-gray-300 text-blue-700 focus:ring-blue-600"
                    />
                    Auto-scroll
                  </label>
                  <button type="button" onClick={handleDownloadLogs} className="text-gray-500 transition-colors hover:text-blue-700" title="Download logs">
                    <Download className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div ref={logRef} className="flex-1 overflow-y-auto bg-gray-950 p-2 font-mono text-[11px] leading-relaxed text-gray-300">
                {filteredLogs.length > 0 ? (
                  filteredLogs.map((line, index) => <LogLine key={`${index}-${line}`} line={line} />)
                ) : (
                  <div className="py-12 text-center text-gray-600">{logFilter ? 'No logs match your filter' : 'Waiting for logs...'}</div>
                )}
                {autoScroll && (
                  <div className="pointer-events-none sticky bottom-2 right-2 flex justify-end">
                    <div className="rounded border border-blue-500/30 bg-blue-600/20 p-1 text-blue-400 backdrop-blur-sm">
                      <ArrowDown className="h-3 w-3" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded border bg-white p-5 shadow-sm">
              <h2 className="mb-4 border-b pb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">Timeline</h2>
              <div className="space-y-3 text-[12px]">
                <SideRow label="Created" value={formatDate(task.created_at)} />
                <SideRow label="Started" value={formatDate(task.started_at)} />
                <SideRow label="Completed" value={formatDate(task.completed_at)} />
              </div>
            </div>

            <div className="rounded border bg-white p-5 shadow-sm">
              <h2 className="mb-4 border-b pb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">Artifacts</h2>
              {task.status === 'completed' ? (
                <div className="space-y-4 text-[12px]">
                  <InfoBlock label="ISO name" value={task.output_iso || '-'} mono />
                  <SideRow label="File size" value={formatBytes(task.output_iso_size)} />
                  <InfoBlock label="SHA256 checksum" value={task.output_iso_sha256 || '-'} mono />
                  {downloadUrl && (
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">Download link</div>
                      <div className="flex items-start gap-2">
                        <a href={downloadUrl} target="_blank" rel="noreferrer" download className="min-w-0 flex-1 break-all rounded border bg-gray-50 p-2 font-mono text-[12px] text-blue-700 underline decoration-blue-200 underline-offset-2">
                          {downloadUrl}
                        </a>
                        <button type="button" onClick={copyArtifactLink} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-50" title="Copy download link">
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-1 text-[11px] text-gray-400">{publicDownloadUrl ? 'Public bucket URL' : 'Backend proxy download'}</div>
                    </div>
                  )}
                </div>
              ) : task.status === 'failed' ? (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                  <span className="mb-1 block font-bold">Error Message</span>
                  {task.error_message || 'Build failed without specific error.'}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                  <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-700 border-t-transparent" />
                  <span className="text-[10px] font-bold uppercase">Processing</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</div>
      <div className={cn('break-all rounded border bg-gray-50 p-2 text-gray-900', mono && 'font-mono text-[12px]')}>{value}</div>
    </div>
  )
}

function SideRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-gray-400">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  )
}
