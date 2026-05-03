import * as Tabs from '@radix-ui/react-tabs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { listBuckets } from '../api/buckets'
import { deleteFile, listDepots, listDrivers, listISOs, refreshFiles, uploadFile } from '../api/files'
import type { FileMetadata } from '../types'
import { formatBytes, formatDate } from '../utils'

const primaryButton = 'rounded border border-[#0051c3] bg-[#0051c3] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#0043a5] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton = 'rounded border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60'
const selectClass = 'rounded border border-gray-300 bg-white px-3 py-1.5 text-[13px] outline-none focus:border-blue-600'
const tabClass = 'border-b-2 border-transparent px-5 py-3 text-[13px] font-semibold text-gray-500 data-[state=active]:border-blue-600 data-[state=active]:bg-white data-[state=active]:text-blue-700'

function fileName(file: FileMetadata) {
  return file.path.split('/').pop() || file.path
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={colSpan}>{label}</td>
    </tr>
  )
}

export default function FilesPage() {
  const queryClient = useQueryClient()
  const [bucketId, setBucketId] = useState<number | ''>('')
  const [version, setVersion] = useState('8.x')
  const [category, setCategory] = useState('network')
  const [message, setMessage] = useState<string | null>(null)

  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const selectedBucketId = useMemo(() => {
    if (typeof bucketId === 'number') return bucketId
    const defaultBucket = bucketsQuery.data?.find((bucket) => bucket.is_default)
    return defaultBucket?.id ?? bucketsQuery.data?.[0]?.id
  }, [bucketId, bucketsQuery.data])
  const selectedBucket = useMemo(
    () => bucketsQuery.data?.find((bucket) => bucket.id === selectedBucketId),
    [bucketsQuery.data, selectedBucketId]
  )

  const depotsQuery = useQuery({
    queryKey: ['depots', selectedBucketId],
    queryFn: () => listDepots(selectedBucketId as number),
    enabled: Boolean(selectedBucketId),
  })
  const driversQuery = useQuery({
    queryKey: ['drivers', selectedBucketId, version, category],
    queryFn: () => listDrivers(selectedBucketId as number, version, category),
    enabled: Boolean(selectedBucketId),
  })
  const isoQuery = useQuery({
    queryKey: ['isos', selectedBucketId],
    queryFn: () => listISOs(selectedBucketId as number),
    enabled: Boolean(selectedBucketId),
  })

  const uploadMutation = useMutation({
    mutationFn: ({ type, file, esxiVersion, driverCategory }: { type: 'depot' | 'driver' | 'iso'; file: File; esxiVersion?: string; driverCategory?: string }) =>
      uploadFile(selectedBucketId as number, type, file, esxiVersion, driverCategory),
    onSuccess: async () => {
      setMessage('文件已上传')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['depots', selectedBucketId] }),
        queryClient.invalidateQueries({ queryKey: ['drivers', selectedBucketId] }),
        queryClient.invalidateQueries({ queryKey: ['isos', selectedBucketId] }),
      ])
    },
    onError: (error) => setMessage(String(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteFile,
    onSuccess: async () => {
      setMessage('文件已删除')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['depots', selectedBucketId] }),
        queryClient.invalidateQueries({ queryKey: ['drivers', selectedBucketId] }),
        queryClient.invalidateQueries({ queryKey: ['isos', selectedBucketId] }),
      ])
    },
    onError: (error) => setMessage(String(error)),
  })

  const refreshMutation = useMutation({
    mutationFn: () => refreshFiles(selectedBucketId as number),
    onSuccess: async () => {
      setMessage('元数据已从存储刷新')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['depots', selectedBucketId] }),
        queryClient.invalidateQueries({ queryKey: ['drivers', selectedBucketId] }),
        queryClient.invalidateQueries({ queryKey: ['isos', selectedBucketId] }),
      ])
    },
    onError: (error) => setMessage(String(error)),
  })

  const handleUpload = (type: 'depot' | 'driver' | 'iso', file?: File | null) => {
    if (!file || !selectedBucketId) return
    setMessage(null)
    uploadMutation.mutate({ type, file, esxiVersion: type === 'driver' ? version : undefined, driverCategory: type === 'driver' ? category : undefined })
  }

  const copyIsoLink = async (file: FileMetadata) => {
    const link = selectedBucket?.public_domain
      ? `${selectedBucket.public_domain.replace(/\/$/, '')}/${selectedBucket.bucket_name}/${file.path}`
      : file.path
    try {
      await navigator.clipboard.writeText(link)
      setMessage('ISO 链接已复制')
    } catch (error) {
      setMessage(String(error))
    }
  }

  const depotCount = depotsQuery.data?.length ?? 0
  const driverCount = driversQuery.data?.length ?? 0
  const isoCount = isoQuery.data?.length ?? 0

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-gray-500">
            账户 / <span className="font-bold text-gray-900">文件库</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">文件库</h1>
          <p className="text-sm text-gray-500">管理 Depot、驱动和构建产物 ISO，文件仍通过真实后端 API 读写。</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select className={selectClass} value={selectedBucketId ?? ''} onChange={(e) => setBucketId(e.target.value ? Number(e.target.value) : '')}>
            {!selectedBucketId && <option value="">选择存储节点</option>}
            {(bucketsQuery.data ?? []).map((bucket) => (
              <option key={bucket.id} value={bucket.id}>{bucket.name}{bucket.is_default ? ' (默认)' : ''}</option>
            ))}
          </select>
          <button className={secondaryButton} onClick={() => refreshMutation.mutate()} disabled={!selectedBucketId || refreshMutation.isPending}>
            {refreshMutation.isPending ? '刷新中...' : '刷新元数据'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">当前存储</p>
          <p className="mt-2 truncate text-sm font-semibold text-blue-700">{selectedBucket?.name ?? '未选择'}</p>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Depots</p>
          <p className="mt-2 text-2xl font-bold">{depotCount}</p>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Drivers</p>
          <p className="mt-2 text-2xl font-bold">{driverCount}</p>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">ISOs</p>
          <p className="mt-2 text-2xl font-bold">{isoCount}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">上传</span>
        <label className={`${secondaryButton} inline-flex cursor-pointer`}>
          Depot
          <input className="hidden" type="file" disabled={!selectedBucketId || uploadMutation.isPending} onChange={(e) => handleUpload('depot', e.target.files?.[0])} />
        </label>
        <select className={selectClass} value={version} onChange={(e) => setVersion(e.target.value)}>
          <option value="6.x">ESXi 6.x</option>
          <option value="7.x">ESXi 7.x</option>
          <option value="8.x">ESXi 8.x</option>
          <option value="9.x">ESXi 9.x</option>
        </select>
        <select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="network">Network</option>
          <option value="storage">Storage</option>
          <option value="raid">RAID</option>
          <option value="backup">Backup</option>
        </select>
        <label className={`${secondaryButton} inline-flex cursor-pointer`}>
          Driver
          <input className="hidden" type="file" disabled={!selectedBucketId || uploadMutation.isPending} onChange={(e) => handleUpload('driver', e.target.files?.[0])} />
        </label>
        <label className={`${primaryButton} inline-flex cursor-pointer`}>
          ISO
          <input className="hidden" type="file" disabled={!selectedBucketId || uploadMutation.isPending} onChange={(e) => handleUpload('iso', e.target.files?.[0])} />
        </label>
        {uploadMutation.isPending && <span className="text-sm text-gray-500">上传中...</span>}
      </div>

      {message && <div className="rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div>}
      {(depotsQuery.isError || driversQuery.isError || isoQuery.isError) && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {String(depotsQuery.error || driversQuery.error || isoQuery.error)}
        </div>
      )}

      <Tabs.Root defaultValue="depots" className="overflow-hidden rounded border border-gray-200 bg-white shadow-sm">
        <Tabs.List className="flex border-b bg-gray-50/50">
          <Tabs.Trigger value="depots" className={tabClass}>Depot 文件</Tabs.Trigger>
          <Tabs.Trigger value="drivers" className={tabClass}>驱动</Tabs.Trigger>
          <Tabs.Trigger value="isos" className={tabClass}>ISO 文件</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="depots">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-[#f9f9fb] text-[11px] font-bold uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-4 py-3">文件名</th>
                <th className="px-4 py-3">大小</th>
                <th className="px-4 py-3">路径</th>
                <th className="px-4 py-3">更新时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {depotsQuery.isLoading && <EmptyRow colSpan={4} label="正在加载 Depot 文件..." />}
              {!depotsQuery.isLoading && depotCount === 0 && <EmptyRow colSpan={4} label="暂无 Depot 文件" />}
              {(depotsQuery.data ?? []).map((file) => (
                <tr key={file.id} className="text-[13px] hover:bg-[#f9f9fb]">
                  <td className="px-4 py-3 font-semibold text-blue-700">{fileName(file)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatBytes(file.size)}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-gray-500">{file.path}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(file.last_modified)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tabs.Content>

        <Tabs.Content value="drivers">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-[#f9f9fb] text-[11px] font-bold uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-4 py-3">驱动名称</th>
                <th className="px-4 py-3">版本</th>
                <th className="px-4 py-3">分类</th>
                <th className="px-4 py-3">说明</th>
                <th className="px-4 py-3">大小</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {driversQuery.isLoading && <EmptyRow colSpan={5} label="正在加载驱动文件..." />}
              {!driversQuery.isLoading && driverCount === 0 && <EmptyRow colSpan={5} label="暂无匹配驱动" />}
              {(driversQuery.data ?? []).map((file) => (
                <tr key={file.id} className="text-[13px] hover:bg-[#f9f9fb]">
                  <td className="px-4 py-3 font-semibold text-blue-700">{file.driver_name || fileName(file)}</td>
                  <td className="px-4 py-3 text-gray-600">{file.driver_version || file.esxi_version || '-'}</td>
                  <td className="px-4 py-3"><span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">{file.driver_category || category}</span></td>
                  <td className="px-4 py-3 text-gray-500">{file.driver_description || file.path}</td>
                  <td className="px-4 py-3 text-gray-600">{formatBytes(file.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tabs.Content>

        <Tabs.Content value="isos">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-[#f9f9fb] text-[11px] font-bold uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-4 py-3">文件名</th>
                <th className="px-4 py-3">大小</th>
                <th className="px-4 py-3">更新时间</th>
                <th className="px-4 py-3">路径</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isoQuery.isLoading && <EmptyRow colSpan={5} label="正在加载 ISO 文件..." />}
              {!isoQuery.isLoading && isoCount === 0 && <EmptyRow colSpan={5} label="暂无 ISO 文件" />}
              {(isoQuery.data ?? []).map((file) => (
                <tr key={file.id} className="text-[13px] hover:bg-[#f9f9fb]">
                  <td className="px-4 py-3 font-semibold text-blue-700">{fileName(file)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatBytes(file.size)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(file.last_modified)}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-gray-500">{file.path}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button className={secondaryButton} onClick={() => copyIsoLink(file)}>复制</button>
                      <button className="rounded border border-red-200 bg-white px-3 py-1.5 text-[13px] font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => deleteMutation.mutate(file.id)} disabled={deleteMutation.isPending}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
