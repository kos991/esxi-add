import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, ChevronRight, FileArchive, HardDrive, PackagePlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listBuckets } from '../api/buckets'
import { createBuild } from '../api/builds'
import { listDepots, listDrivers } from '../api/files'
import { cn } from '../utils'

const esxiVersions = ['6.5', '6.7', '7.0', '8.0', '9.0']

const stepLabels = ['源文件', '注入驱动', '确认启动']

export default function BuildPage() {
  const navigate = useNavigate()
  const [bucketId, setBucketId] = useState<number | ''>('')
  const [version, setVersion] = useState('8.0')
  const [depotPath, setDepotPath] = useState('')
  const [driverPaths, setDriverPaths] = useState<string[]>([])
  const [customISOName, setCustomISOName] = useState('')
  const [step, setStep] = useState(1)
  const [message, setMessage] = useState<string | null>(null)

  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const selectedBucketId = useMemo(() => {
    if (typeof bucketId === 'number') return bucketId
    return bucketsQuery.data?.[0]?.id
  }, [bucketId, bucketsQuery.data])

  const depotsQuery = useQuery({
    queryKey: ['build-depots', selectedBucketId],
    queryFn: () => listDepots(selectedBucketId as number),
    enabled: Boolean(selectedBucketId),
  })
  const driversQuery = useQuery({
    queryKey: ['build-drivers', selectedBucketId, version],
    queryFn: () => listDrivers(selectedBucketId as number, version),
    enabled: Boolean(selectedBucketId),
  })

  const selectedBucket = useMemo(
    () => bucketsQuery.data?.find((bucket) => bucket.id === selectedBucketId),
    [bucketsQuery.data, selectedBucketId]
  )

  const groupedDrivers = useMemo(() => {
    const groups: Record<string, NonNullable<typeof driversQuery.data>> = {}
    for (const driver of driversQuery.data ?? []) {
      const key = driver.driver_category || 'other'
      groups[key] = [...(groups[key] ?? []), driver]
    }
    return groups
  }, [driversQuery.data])

  const createMutation = useMutation({
    mutationFn: createBuild,
    onSuccess: (task) => navigate(`/tasks/${task.task_id}`),
    onError: (error) => setMessage(String(error)),
  })

  const toggleDriver = (value: string) => {
    setDriverPaths((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]))
  }

  const canAdvanceSource = Boolean(selectedBucketId && depotPath)

  const nextStep = () => {
    if (step === 1 && !canAdvanceSource) {
      setMessage('请选择存储节点和 Depot 文件')
      return
    }
    setMessage(null)
    setStep((current) => Math.min(3, current + 1))
  }

  const submit = () => {
    if (!selectedBucketId || !depotPath) {
      setMessage('请选择存储节点和 Depot 文件')
      setStep(1)
      return
    }

    createMutation.mutate({
      bucket_id: selectedBucketId,
      esxi_version: version,
      depot_path: depotPath,
      driver_paths: driverPaths,
      custom_iso_name: customISOName || undefined,
    })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[12px] font-medium text-blue-700">构建 / 自定义 ISO</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-950">定制构建向导</h1>
        </div>
        <div className="hidden items-center gap-2 text-[12px] font-medium text-gray-500 md:flex">
          <HardDrive className="h-4 w-4" />
          {selectedBucket?.name ?? '未选择存储节点'}
        </div>
      </div>

      {message && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>}

      <div className="overflow-hidden rounded border bg-white shadow-sm">
        <div className="flex border-b bg-gray-50/70 text-[13px]">
          {stepLabels.map((label, index) => {
            const number = index + 1
            return (
              <button
                key={label}
                type="button"
                onClick={() => setStep(number)}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-5 py-3 font-medium transition-colors',
                  step === number ? 'border-blue-700 bg-white text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-900'
                )}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded border text-[11px]">{number}</span>
                {label}
              </button>
            )
          })}
        </div>

        <div className="min-h-[430px] p-6">
          {step === 1 && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="max-w-xl space-y-6">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-600">存储节点</label>
                  <select
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-600"
                    value={selectedBucketId ?? ''}
                    onChange={(e) => setBucketId(Number(e.target.value))}
                  >
                    {(bucketsQuery.data ?? []).map((bucket) => (
                      <option key={bucket.id} value={bucket.id}>
                        {bucket.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-600">ESXi 基础版本</label>
                  <div className="grid grid-cols-5 gap-2">
                    {esxiVersions.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setVersion(item)}
                        className={cn(
                          'rounded border px-3 py-2 text-[12px] font-bold transition-colors',
                          version === item ? 'border-blue-700 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700 hover:border-gray-400'
                        )}
                      >
                        v{item}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-600">Depot 文件</label>
                  <select
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-600"
                    value={depotPath}
                    onChange={(e) => setDepotPath(e.target.value)}
                  >
                    <option value="">选择 Depot 文件</option>
                    {(depotsQuery.data ?? []).map((file) => (
                      <option key={file.id} value={file.path}>
                        {file.path}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded border bg-gray-50 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-white text-blue-700">
                    <FileArchive className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">已选源文件</div>
                    <div className="text-sm font-semibold text-gray-950">ESXi {version}</div>
                  </div>
                </div>
                <div className="mt-5 space-y-3 text-[12px]">
                  <div>
                    <div className="font-bold uppercase tracking-wider text-gray-400">存储节点</div>
                    <div className="mt-1 break-all font-medium text-gray-900">{selectedBucket?.name ?? '-'}</div>
                  </div>
                  <div>
                    <div className="font-bold uppercase tracking-wider text-gray-400">Depot</div>
                    <div className="mt-1 break-all font-mono text-gray-700">{depotPath || '-'}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-gray-950">选择注入驱动</h2>
                  <p className="text-[12px] text-gray-500">已为 ESXi {version} 选择 {driverPaths.length} 个驱动</p>
                </div>
                <span className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase text-blue-700">
                  {version}
                </span>
              </div>

              {driversQuery.isLoading && <div className="rounded border bg-gray-50 p-5 text-sm text-gray-500">正在加载驱动...</div>}
              {!driversQuery.isLoading && Object.keys(groupedDrivers).length === 0 && (
                <div className="rounded border bg-gray-50 p-5 text-sm text-gray-500">当前存储节点和版本下没有匹配驱动。</div>
              )}

              {Object.entries(groupedDrivers).map(([group, items]) => (
                <div key={group} className="space-y-3">
                  <h3 className="border-b pb-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">{group}</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {items.map((driver) => (
                      <label key={driver.id} className="flex cursor-pointer items-start gap-3 rounded border bg-white p-4 shadow-sm hover:border-blue-300">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-700 focus:ring-blue-600"
                          checked={driverPaths.includes(driver.path)}
                          onChange={() => toggleDriver(driver.path)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-bold text-gray-950">{driver.driver_name || driver.path.split('/').pop()}</span>
                            <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                              {driver.driver_version || version}
                            </span>
                          </span>
                          <span className="mt-1 block break-all text-[12px] text-gray-500">{driver.driver_description || driver.path}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,520px)_1fr]">
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-600">输出镜像名称</label>
                  <input
                    className="w-full rounded border border-gray-300 px-3 py-2.5 font-mono text-sm outline-none focus:border-blue-600"
                    value={customISOName}
                    onChange={(e) => setCustomISOName(e.target.value)}
                    placeholder="custom-esxi.iso"
                  />
                </div>
                <div className="rounded border bg-gray-50 p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-bold text-gray-950">
                    <PackagePlus className="h-4 w-4 text-blue-700" />
                    构建摘要
                  </div>
                  <div className="space-y-3 text-sm">
                    <SummaryRow label="存储节点" value={selectedBucket?.name ?? '-'} />
                    <SummaryRow label="基础版本" value={`ESXi ${version}`} />
                    <SummaryRow label="Depot" value={depotPath || '-'} mono />
                    <SummaryRow label="注入驱动" value={`已选择 ${driverPaths.length} 个`} />
                    <SummaryRow label="ISO 名称" value={customISOName || '使用后端默认名称'} mono />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t bg-gray-50/70 p-4">
          {step > 1 && (
            <button type="button" onClick={() => setStep((current) => Math.max(1, current - 1))} className="rounded border bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              上一步
            </button>
          )}
          {step < 3 ? (
            <button type="button" onClick={nextStep} className="inline-flex items-center gap-2 rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
              下一步
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={submit}
              disabled={createMutation.isPending}
            >
              <Check className="h-4 w-4" />
              {createMutation.isPending ? '提交中...' : '启动 ISO 构建任务'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className={cn('max-w-[70%] break-all text-right font-semibold text-gray-950', mono && 'font-mono text-[12px]')}>{value}</span>
    </div>
  )
}
