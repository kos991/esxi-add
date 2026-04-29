import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listBuilds } from '../api/builds'
import { cn, formatDate } from '../utils'

const statusClasses = {
  pending: 'bg-gray-100 text-gray-700',
  running: 'bg-blue-100 text-blue-700 animate-pulse',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Build Tasks</h1>
        <p className="text-sm text-gray-500">Monitor build history and current progress.</p>
      </div>

      {tasksQuery.isError && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{String(tasksQuery.error)}</div>}

      <div className="overflow-hidden rounded-lg border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-3">Task ID</th>
              <th className="px-4 py-3">ESXi</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(tasksQuery.data?.items ?? []).map((task) => (
              <tr key={task.task_id} className="cursor-pointer border-t hover:bg-gray-50" onClick={() => navigate(`/tasks/${task.task_id}`)}>
                <td className="px-4 py-3 font-mono text-xs">{task.task_id}</td>
                <td className="px-4 py-3">{task.esxi_version}</td>
                <td className="px-4 py-3">
                  <span className={cn('rounded-full px-2 py-1 text-xs font-medium', statusClasses[task.status])}>{task.status}</span>
                </td>
                <td className="px-4 py-3">{formatDate(task.created_at)}</td>
                <td className="px-4 py-3 text-blue-600">View details</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
