import * as Tabs from '@radix-ui/react-tabs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Pencil, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { listBuckets } from '../api/buckets'
import { deleteFile, listDepots, listDrivers, listISOs, refreshFiles, renameFile, uploadFile } from '../api/files'
import type { FileMetadata, StorageBucket } from '../types'
import { buildPublicObjectUrl, cn, formatBytes, formatDate } from '../utils'

type UploadType = 'depot' | 'driver' | 'iso'
type AssetCacheStatus = 'cached' | 'missing' | 'stale' | 'invalid'

const versions = ['6.5', '6.7', '7.0', '8.0', '9.0']
const categories = [
  { value: 'network', label: 'Network' },
  { value: 'storage', label: 'Storage' },
  { value: 'raid', label: 'RAID' },
  { value: 'other', label: 'Other' },
]

const primaryButton = 'inline-flex items-center gap-2 rounded border border-[#0051c3] bg-[#0051c3] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#0043a5] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton = 'inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60'
const dangerButton = 'inline-flex items-center gap-2 rounded border border-red-200 bg-white px-3 py-1.5 text-[13px] font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60'
const iconButton = 'inline-flex h-8 w-8 items-center justify-center rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60'
const selectClass = 'rounded border border-gray-300 bg-white px-3 py-1.5 text-[13px] outline-none focus:border-blue-600'
const inputClass = 'rounded border border-gray-300 bg-white px-3 py-1.5 text-[13px] outline-none focus:border-blue-600'
const tabClass = 'border-b-2 border-transparent px-5 py-3 text-[13px] font-semibold text-gray-500 data-[state=active]:border-blue-600 data-[state=active]:bg-white data-[state=active]:text-blue-700'
const assetTypeOrder: Record<FileMetadata['type'], number> = { depot: 0, driver: 1, iso: 2 }

const cacheStatusClass: Record<AssetCacheStatus, string> = {
  cached: 'border-green-200 bg-green-50 text-green-700',
  missing: 'border-gray-200 bg-gray-50 text-gray-600',
  stale: 'border-orange-200 bg-orange-50 text-orange-700',
  invalid: 'border-red-200 bg-red-50 text-red-700',
}

function fileName(file: FileMetadata) {
  return file.path.split('/').pop() || file.path
}

function displayName(file: FileMetadata) {
  return file.driver_name || fileName(file)
}

function displayWithDescription(file: FileMetadata) {
  return file.driver_description ? `${displayName(file)}(${file.driver_description})` : displayName(file)
}

function checksumText(file: FileMetadata) {
  return `MD5: ${file.md5 || '暂无'}`
}

function bucketType(bucket?: StorageBucket) {
  return bucket?.type === 'local' ? 'local' : 's3'
}

function bucketLocation(bucket?: StorageBucket) {
  if (!bucket) return '-'
  return bucketType(bucket) === 'local' ? bucket.local_path || '-' : bucket.endpoint || '-'
}

function providerText(bucket?: StorageBucket) {
  if (!bucket) {
    return {
      label: '未选择存储',
      description: '选择节点后展示对象路径、公开域名和资产统计。',
    }
  }
  if (bucketType(bucket) === 'local') {
    return {
      label: 'Local filesystem',
      description: '使用服务端本地路径保存 Depot、Driver 和 ISO 资产。',
    }
  }
  if ((bucket.endpoint || '').toLowerCase().includes('r2.cloudflarestorage.com')) {
    return {
      label: 'Cloudflare R2',
      description: 'S3 兼容对象存储，适合配合 public_domain 对外分发构建产物。',
    }
  }
  return {
    label: 'S3-compatible',
    description: '支持 AWS S3、MinIO 以及其他 S3 兼容 endpoint。',
  }
}

function isOutputAsset(file: FileMetadata) {
  return file.path.toLowerCase().startsWith('output/')
}

function assetTypeLabel(file: FileMetadata) {
  if (isOutputAsset(file)) return 'Output ISO'
  if (file.type === 'depot') return 'Depot'
  if (file.type === 'driver') return 'Driver'
  return 'ISO'
}

function assetTypeClass(file: FileMetadata) {
  if (isOutputAsset(file)) return 'border-purple-200 bg-purple-50 text-purple-700'
  if (file.type === 'depot') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (file.type === 'driver') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-sky-200 bg-sky-50 text-sky-700'
}

function cacheStatus(file: FileMetadata, bucket?: StorageBucket): AssetCacheStatus {
  if (file.cache_status) return file.cache_status
  if (bucketType(bucket) === 'local') return 'cached'
  if (file.cache_valid === false) return 'invalid'
  if (file.cached) return 'cached'
  return 'missing'
}

function canCopyPublicLink(file: FileMetadata, bucket?: StorageBucket) {
  return Boolean(bucket?.public_domain?.trim()) || file.type === 'iso' || isOutputAsset(file)
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
  const [version, setVersion] = useState('8.0')
  const [category, setCategory] = useState('network')
  const [uploadType, setUploadType] = useState<UploadType>('depot')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
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
  const allDriversQuery = useQuery({
    queryKey: ['drivers', selectedBucketId, 'all'],
    queryFn: () => listDrivers(selectedBucketId as number),
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

  const invalidateFiles = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['depots', selectedBucketId] }),
      queryClient.invalidateQueries({ queryKey: ['drivers', selectedBucketId] }),
      queryClient.invalidateQueries({ queryKey: ['isos', selectedBucketId] }),
      queryClient.invalidateQueries({ queryKey: ['build-depots', selectedBucketId] }),
      queryClient.invalidateQueries({ queryKey: ['build-drivers', selectedBucketId] }),
    ])
  }

  const uploadMutation = useMutation({
    mutationFn: ({ type, file }: { type: UploadType; file: File }) =>
      uploadFile(
        selectedBucketId as number,
        type,
        file,
        type === 'iso' ? undefined : version,
        type === 'driver' ? category : undefined
      ),
    onSuccess: async () => {
      setMessage('文件已上传')
      setSelectedFile(null)
      setFileInputKey((current) => current + 1)
      await invalidateFiles()
    },
    onError: (error) => setMessage(String(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteFile,
    onSuccess: async () => {
      setMessage('文件已删除')
      await invalidateFiles()
    },
    onError: (error) => setMessage(String(error)),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => renameFile(id, name),
    onSuccess: async () => {
      setMessage('文件已重命名')
      setRenamingId(null)
      setRenameValue('')
      await invalidateFiles()
    },
    onError: (error) => setMessage(String(error)),
  })

  const refreshMutation = useMutation({
    mutationFn: () => refreshFiles(selectedBucketId as number),
    onSuccess: async () => {
      setMessage('元数据已从存储刷新')
      await invalidateFiles()
    },
    onError: (error) => setMessage(String(error)),
  })

  const submitUpload = () => {
    if (!selectedBucketId || !selectedFile) return
    setMessage(null)
    uploadMutation.mutate({ type: uploadType, file: selectedFile })
  }

  const startRename = (file: FileMetadata) => {
    setRenamingId(file.id)
    setRenameValue(displayName(file))
  }

  const submitRename = (file: FileMetadata) => {
    const name = renameValue.trim()
    if (!name) return
    renameMutation.mutate({ id: file.id, name })
  }

  const removeFile = (file: FileMetadata) => {
    if (window.confirm(`删除 ${displayName(file)}？`)) {
      deleteMutation.mutate(file.id)
    }
  }

  const copyPublicLink = async (file: FileMetadata) => {
    const link = selectedBucket?.public_domain
      ? buildPublicObjectUrl(selectedBucket.public_domain, file.path)
      : file.path
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setMessage('链接已复制')
    } catch (error) {
      setMessage(String(error))
    }
  }

  const depotCount = depotsQuery.data?.length ?? 0
  const driverCount = allDriversQuery.data?.length ?? 0
  const isoCount = isoQuery.data?.length ?? 0
  const assetCount = depotCount + driverCount + isoCount
  const allAssets = useMemo(
    () =>
      [...(depotsQuery.data ?? []), ...(allDriversQuery.data ?? []), ...(isoQuery.data ?? [])].sort(
        (a, b) => assetTypeOrder[a.type] - assetTypeOrder[b.type] || a.path.localeCompare(b.path)
      ),
    [allDriversQuery.data, depotsQuery.data, isoQuery.data]
  )
  const allAssetsLoading = depotsQuery.isLoading || allDriversQuery.isLoading || isoQuery.isLoading

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-gray-500">
            账户 / <span className="font-bold text-gray-900">文件库</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">文件库</h1>
          <p className="text-sm text-gray-500">管理 Depot、驱动和构建产物 ISO，文件通过后端 API 读写。</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select className={selectClass} value={selectedBucketId ?? ''} onChange={(e) => setBucketId(e.target.value ? Number(e.target.value) : '')}>
            {!selectedBucketId && <option value="">选择存储节点</option>}
            {(bucketsQuery.data ?? []).map((bucket) => (
              <option key={bucket.id} value={bucket.id}>{bucket.name}{bucket.is_default ? ' (默认)' : ''}</option>
            ))}
          </select>
          <button className={secondaryButton} onClick={() => refreshMutation.mutate()} disabled={!selectedBucketId || refreshMutation.isPending}>
            <RefreshCw className="h-4 w-4" />
            {refreshMutation.isPending ? '刷新中...' : '刷新元数据'}
          </button>
        </div>
      </div>

      <StorageOverview bucket={selectedBucket} loading={bucketsQuery.isLoading} />

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="全部资产" value={String(assetCount)} emphasis />
        <Metric label="Depots" value={String(depotCount)} />
        <Metric label="Drivers" value={String(driverCount)} />
        <Metric label="ISOs" value={String(isoCount)} />
      </div>

      <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">上传类型</label>
            <select className={selectClass} value={uploadType} onChange={(e) => setUploadType(e.target.value as UploadType)}>
              <option value="depot">Depot</option>
              <option value="driver">Driver</option>
              <option value="iso">ISO</option>
            </select>
          </div>
          {uploadType !== 'iso' && (
            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">ESXi 版本</label>
              <select className={selectClass} value={version} onChange={(e) => setVersion(e.target.value)}>
                {versions.map((item) => (
                  <option key={item} value={item}>ESXi {item}</option>
                ))}
              </select>
            </div>
          )}
          {uploadType === 'driver' && (
            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">驱动分类</label>
              <select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className="min-w-[260px] flex-1 space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">文件</label>
            <input key={fileInputKey} className={inputClass} type="file" disabled={!selectedBucketId || uploadMutation.isPending} onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} />
          </div>
          <button className={primaryButton} onClick={submitUpload} disabled={!selectedBucketId || !selectedFile || uploadMutation.isPending}>
            <Upload className="h-4 w-4" />
            {uploadMutation.isPending ? '上传中...' : '上传'}
          </button>
        </div>
      </div>

      {message && <div className="rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div>}
      {(depotsQuery.isError || allDriversQuery.isError || driversQuery.isError || isoQuery.isError) && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {String(depotsQuery.error || allDriversQuery.error || driversQuery.error || isoQuery.error)}
        </div>
      )}

      <Tabs.Root defaultValue="all" className="overflow-hidden rounded border border-gray-200 bg-white shadow-sm">
        <Tabs.List className="flex overflow-x-auto border-b bg-gray-50/50">
          <Tabs.Trigger value="all" className={tabClass}>全部资产 ({assetCount})</Tabs.Trigger>
          <Tabs.Trigger value="depots" className={tabClass}>Depot ({depotCount})</Tabs.Trigger>
          <Tabs.Trigger value="drivers" className={tabClass}>Driver ({driverCount})</Tabs.Trigger>
          <Tabs.Trigger value="isos" className={tabClass}>ISO ({isoCount})</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="all">
          <FileTable
            files={allAssets}
            loading={allAssetsLoading}
            emptyLabel="暂无资产"
            bucket={selectedBucket}
            onCopy={copyPublicLink}
            onStartRename={startRename}
            onSubmitRename={submitRename}
            onCancelRename={() => setRenamingId(null)}
            onDelete={removeFile}
            renamingId={renamingId}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            busy={deleteMutation.isPending || renameMutation.isPending}
          />
        </Tabs.Content>

        <Tabs.Content value="depots">
          <FileTable
            files={depotsQuery.data ?? []}
            loading={depotsQuery.isLoading}
            emptyLabel="暂无 Depot 文件"
            bucket={selectedBucket}
            onCopy={copyPublicLink}
            onStartRename={startRename}
            onSubmitRename={submitRename}
            onCancelRename={() => setRenamingId(null)}
            onDelete={removeFile}
            renamingId={renamingId}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            busy={deleteMutation.isPending || renameMutation.isPending}
          />
        </Tabs.Content>

        <Tabs.Content value="drivers">
          <div className="border-b bg-gray-50/40 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">筛选</span>
              <select className={selectClass} value={version} onChange={(e) => setVersion(e.target.value)}>
                {versions.map((item) => (
                  <option key={item} value={item}>ESXi {item}</option>
                ))}
              </select>
              <select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>
          <FileTable
            files={driversQuery.data ?? []}
            loading={driversQuery.isLoading}
            emptyLabel="暂无匹配驱动"
            bucket={selectedBucket}
            onCopy={copyPublicLink}
            onStartRename={startRename}
            onSubmitRename={submitRename}
            onCancelRename={() => setRenamingId(null)}
            onDelete={removeFile}
            renamingId={renamingId}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            busy={deleteMutation.isPending || renameMutation.isPending}
          />
        </Tabs.Content>

        <Tabs.Content value="isos">
          <FileTable
            files={isoQuery.data ?? []}
            loading={isoQuery.isLoading}
            emptyLabel="暂无 ISO 文件"
            bucket={selectedBucket}
            onCopy={copyPublicLink}
            onStartRename={startRename}
            onSubmitRename={submitRename}
            onCancelRename={() => setRenamingId(null)}
            onDelete={removeFile}
            renamingId={renamingId}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            busy={deleteMutation.isPending || renameMutation.isPending}
          />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}

function StorageOverview({ bucket, loading }: { bucket?: StorageBucket; loading: boolean }) {
  const provider = providerText(bucket)
  const typeLabel = bucket ? (bucketType(bucket) === 'local' ? 'Local' : 'S3') : '-'
  const locationLabel = bucketType(bucket) === 'local' ? 'Local path' : 'Endpoint'

  return (
    <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">当前存储节点</div>
          <div className="mt-1 text-lg font-bold text-gray-950">{loading ? '加载中...' : bucket?.name ?? '未选择'}</div>
          <p className="mt-1 text-[12px] text-gray-500">{provider.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">{provider.label}</span>
          <span className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-600">{typeLabel}</span>
          {bucket?.is_default && <span className="rounded border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase text-green-700">Default</span>}
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <StorageField label="默认" value={bucket ? (bucket.is_default ? '是' : '否') : '-'} />
        <StorageField label={locationLabel} value={bucketLocation(bucket)} mono />
        <StorageField label="Public domain" value={bucket?.public_domain?.trim() || '未配置'} mono />
      </div>
    </div>
  )
}

function StorageField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</div>
      <div className={cn('mt-1 truncate text-[13px] text-gray-800', mono && 'font-mono')}>{value}</div>
    </div>
  )
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={cn('mt-2 truncate font-bold', emphasis ? 'text-sm text-blue-700' : 'text-2xl text-gray-950')}>{value}</p>
    </div>
  )
}

function CacheTag({ file, bucket }: { file: FileMetadata; bucket?: StorageBucket }) {
  const status = cacheStatus(file, bucket)
  return <span className={cn('inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase', cacheStatusClass[status])}>{status}</span>
}

function FileTable({
  files,
  loading,
  emptyLabel,
  bucket,
  onCopy,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onDelete,
  renamingId,
  renameValue,
  setRenameValue,
  busy,
}: {
  files: FileMetadata[]
  loading: boolean
  emptyLabel: string
  bucket?: StorageBucket
  onCopy?: (file: FileMetadata) => void
  onStartRename: (file: FileMetadata) => void
  onSubmitRename: (file: FileMetadata) => void
  onCancelRename: () => void
  onDelete: (file: FileMetadata) => void
  renamingId: number | null
  renameValue: string
  setRenameValue: (value: string) => void
  busy: boolean
}) {
  const colSpan = 7

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-[#f9f9fb] text-[11px] font-bold uppercase tracking-wider text-gray-600">
          <tr>
            <th className="px-4 py-3">资产</th>
            <th className="px-4 py-3">类型</th>
            <th className="px-4 py-3">路径</th>
            <th className="px-4 py-3">大小</th>
            <th className="px-4 py-3">更新时间</th>
            <th className="px-4 py-3">缓存</th>
            <th className="px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {loading && <EmptyRow colSpan={colSpan} label="正在加载文件..." />}
          {!loading && files.length === 0 && <EmptyRow colSpan={colSpan} label={emptyLabel} />}
          {files.map((file) => {
            const copyEnabled = onCopy && canCopyPublicLink(file, bucket)

            return (
              <tr key={file.id} className="text-[13px] hover:bg-[#f9f9fb]">
                <td className="px-4 py-3">
                  {renamingId === file.id ? (
                    <input className={inputClass} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
                  ) : (
                    <>
                      <div className="font-semibold text-blue-700">{displayWithDescription(file)}</div>
                      <div className="mt-1 break-all font-mono text-[11px] text-gray-500">{checksumText(file)}</div>
                    </>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase', assetTypeClass(file))}>{assetTypeLabel(file)}</span>
                    {file.esxi_version && <span className="text-[11px] text-gray-500">ESXi {file.esxi_version}</span>}
                    {file.driver_category && <span className="text-[11px] text-gray-500">{file.driver_category}</span>}
                  </div>
                </td>
                <td className="max-w-[360px] px-4 py-3">
                  <div className="break-all font-mono text-[12px] text-gray-600">{file.path}</div>
                </td>
                <td className="px-4 py-3 text-gray-600">{formatBytes(file.size)}</td>
                <td className="px-4 py-3 text-gray-500">{formatDate(file.last_modified)}</td>
                <td className="px-4 py-3">
                  <CacheTag file={file} bucket={bucket} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {renamingId === file.id ? (
                      <>
                        <button className={iconButton} title="确认重命名" onClick={() => onSubmitRename(file)} disabled={busy}>
                          <Check className="h-4 w-4" />
                        </button>
                        <button className={iconButton} title="取消重命名" onClick={onCancelRename} disabled={busy}>
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        {copyEnabled && (
                          <button className={iconButton} title="复制链接" onClick={() => onCopy?.(file)} disabled={busy}>
                            <Copy className="h-4 w-4" />
                          </button>
                        )}
                        <button className={iconButton} title="重命名" onClick={() => onStartRename(file)} disabled={busy}>
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button className={dangerButton} title="删除" onClick={() => onDelete(file)} disabled={busy}>
                          <Trash2 className="h-4 w-4" />
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
