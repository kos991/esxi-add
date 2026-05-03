import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, CheckCircle2, Clock3, Database } from 'lucide-react'
import { listBuckets } from '../api/buckets'
import { listBuilds } from '../api/builds'
import { formatDate } from '../utils'

export default function OverviewPage() {
  const buildsQuery = useQuery({ queryKey: ['overview-builds'], queryFn: () => listBuilds(1, 20), refetchInterval: 10000 })
  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })

  const stats = useMemo(() => {
    const tasks = buildsQuery.data?.items ?? []
    const completed = tasks.filter((task) => task.status === 'completed').length
    const failed = tasks.filter((task) => task.status === 'failed').length
    const running = tasks.filter((task) => task.status === 'running').length
    const totalFinished = completed + failed
    const successRate = totalFinished === 0 ? 0 : Math.round((completed / totalFinished) * 100)

    return {
      total: buildsQuery.data?.total ?? tasks.length,
      completed,
      running,
      successRate,
      buckets: bucketsQuery.data?.length ?? 0,
    }
  }, [buildsQuery.data, bucketsQuery.data])

  const cards = [
    { label: '构建总数', value: stats.total, tone: 'text-gray-950', icon: Activity },
    { label: '成功率', value: `${stats.successRate}%`, tone: 'text-green-700', icon: CheckCircle2 },
    { label: '运行中任务', value: stats.running, tone: 'text-blue-700', icon: Clock3 },
    { label: '存储节点', value: stats.buckets, tone: 'text-orange-700', icon: Database },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">总览</h1>
        <p className="mt-1 text-sm text-gray-500">构建任务、存储节点和近期活动的运行概况。</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, tone, icon: Icon }) => (
          <div key={label} className="stat-card flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
              <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
            </div>
            <Icon className="h-5 w-5 text-gray-400" />
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded border bg-white shadow-sm">
        <div className="border-b bg-gray-50 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500">近期构建</div>
        <table className="w-full text-left text-sm">
          <thead className="table-header">
            <tr>
              <th className="px-4 py-3">任务 ID</th>
              <th className="px-4 py-3">ESXi</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {(buildsQuery.data?.items ?? []).slice(0, 6).map((task) => (
              <tr key={task.task_id} className="table-row">
                <td className="px-4 py-4 font-mono text-xs text-blue-700">{task.task_id}</td>
                <td className="px-4 py-4">{task.esxi_version}</td>
                <td className="px-4 py-4"><span className={`tag tag-${task.status}`}>{task.status}</span></td>
                <td className="px-4 py-4 text-gray-500">{formatDate(task.created_at)}</td>
              </tr>
            ))}
            {!buildsQuery.isLoading && (buildsQuery.data?.items ?? []).length === 0 && (
              <tr><td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={4}>暂无构建任务</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
