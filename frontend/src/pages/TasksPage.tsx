import { useQuery } from '@tanstack/react-query'
import { Clock3, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { listBuilds } from '../api/builds'
import { cn, formatDate } from '../utils'

const statusClasses = {
  pending: 'border-gray-200 bg-gray-100 text-gray-700',
  running: 'border-blue-200 bg-blue-50 text-blue-700',
  completed: 'border-green-200 bg-green-50 text-green-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
}

export default function TasksPage() {
  const navigate = useNavigate()
  const tasksQuery = useQuery({
    queryKey: ['builds', 1, 20],
    queryFn: () => listBuilds(1, 20),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? []
      return items.some((task) => task.status === 'running') ? 5000 : false
    },
  })

  const tasks = tasksQuery.data?.items ?? []

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[12px] font-medium text-blue-700">Builds / History</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-950">Build Tasks</h1>
        </div>
        <div className="hidden items-center gap-2 text-[12px] font-medium text-gray-500 md:flex">
          <Clock3 className="h-4 w-4" />
          {tasksQuery.isFetching ? 'Refreshing' : `${tasks.length} loaded`}
        </div>
      </div>

      {tasksQuery.isError && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{String(tasksQuery.error)}</div>}

      <div className="overflow-hidden rounded border bg-white shadow-sm">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="border-b bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3">Task ID</th>
              <th className="px-4 py-3">ESXi</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Progress</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tasks.map((task) => (
              <tr key={task.task_id} className="cursor-pointer transition-colors hover:bg-gray-50" onClick={() => navigate(`/tasks/${task.task_id}`)}>
                <td className="px-4 py-3">
                  <span className="font-mono text-[12px] font-bold text-blue-700 underline decoration-blue-200 underline-offset-4">{task.task_id}</span>
                </td>
                <td className="px-4 py-3 font-medium text-gray-900">{task.esxi_version}</td>
                <td className="px-4 py-3">
                  <span className={cn('inline-flex rounded border px-2 py-0.5 text-[10px] font-bold uppercase', statusClasses[task.status])}>{task.status}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full bg-blue-700" style={{ width: `${Math.max(0, Math.min(100, task.progress || 0))}%` }} />
                    </div>
                    <span className="text-[12px] font-medium text-gray-500">{task.progress || 0}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-[12px] text-gray-500">{formatDate(task.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  <span className="inline-flex items-center gap-1 text-[12px] font-bold text-blue-700">
                    Details
                    <ExternalLink className="h-3.5 w-3.5" />
                  </span>
                </td>
              </tr>
            ))}
            {!tasksQuery.isLoading && tasks.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                  No build tasks yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
