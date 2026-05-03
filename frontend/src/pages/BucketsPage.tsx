import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useMemo, useState } from 'react'
import { createBucket, deleteBucket, listBuckets, setDefaultBucket, testBucketConnection, type BucketPayload } from '../api/buckets'

const initialForm: BucketPayload = {
  name: '',
  endpoint: '',
  access_key: '',
  secret_key: '',
  bucket_name: '',
  region: '',
  use_ssl: true,
  public_domain: '',
  is_default: false,
}

const inputClass = 'w-full rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-600'
const labelClass = 'space-y-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500'
const primaryButton = 'rounded border border-[#0051c3] bg-[#0051c3] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#0043a5] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton = 'rounded border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60'

export default function BucketsPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [storageType, setStorageType] = useState<'s3' | 'local'>('s3')
  const [localPath, setLocalPath] = useState('')
  const [form, setForm] = useState<BucketPayload>(initialForm)
  const [message, setMessage] = useState<string | null>(null)

  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })

  const createMutation = useMutation({
    mutationFn: createBucket,
    onSuccess: async () => {
      setMessage('存储节点已创建')
      setForm(initialForm)
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['buckets'] })
    },
    onError: (error) => setMessage(String(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteBucket,
    onSuccess: async () => {
      setMessage('存储节点已删除')
      await queryClient.invalidateQueries({ queryKey: ['buckets'] })
    },
    onError: (error) => setMessage(String(error)),
  })

  const defaultMutation = useMutation({
    mutationFn: setDefaultBucket,
    onSuccess: async () => {
      setMessage('默认存储已更新')
      await queryClient.invalidateQueries({ queryKey: ['buckets'] })
    },
    onError: (error) => setMessage(String(error)),
  })

  const testMutation = useMutation({
    mutationFn: testBucketConnection,
    onSuccess: () => setMessage('连接测试成功'),
    onError: (error) => setMessage(String(error)),
  })

  const sortedBuckets = useMemo(
    () => [...(bucketsQuery.data ?? [])].sort((a, b) => Number(b.is_default) - Number(a.is_default)),
    [bucketsQuery.data]
  )

  const defaultBucket = sortedBuckets.find((bucket) => bucket.is_default)

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    if (storageType === 'local') {
      setMessage('本地节点设置已填写。当前后端构建流程仍使用 S3/MinIO 节点，启用本地节点需要后端存储适配。')
      return
    }
    createMutation.mutate(form)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-gray-500">
            账户 / <span className="font-bold text-gray-900">存储与挂载</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">存储与挂载</h1>
          <p className="text-sm text-gray-500">管理构建流程使用的 S3 / MinIO 节点，并预留本地目录节点配置。</p>
        </div>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <button className={primaryButton}>添加存储节点</button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b bg-gray-50 px-6 py-4">
                <Dialog.Title className="font-bold text-gray-950">配置新存储节点</Dialog.Title>
                <Dialog.Close className="text-xl leading-none text-gray-500 hover:text-gray-900" aria-label="关闭">
                  &times;
                </Dialog.Close>
              </div>
              <form className="space-y-6 p-6" onSubmit={onSubmit}>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="md:col-span-2">
                    <span className={labelClass}>存储类型</span>
                    <select
                      className={`${inputClass} mt-1.5 bg-white`}
                      value={storageType}
                      onChange={(e) => setStorageType(e.target.value as 's3' | 'local')}
                    >
                      <option value="s3">S3 兼容存储 (MinIO, AWS S3, R2)</option>
                      <option value="local">本地目录节点 (Local Path)</option>
                    </select>
                  </label>
                  <label>
                    <span className={labelClass}>节点显示名称</span>
                    <input className={`${inputClass} mt-1.5`} value={form.name} placeholder="例如: Production-MinIO" onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
                  </label>
                  {storageType === 's3' ? (
                    <>
                      <label>
                        <span className={labelClass}>Endpoint 地址</span>
                        <input className={`${inputClass} mt-1.5 font-mono`} value={form.endpoint} placeholder="s3.example.com" onChange={(e) => setForm((prev) => ({ ...prev, endpoint: e.target.value }))} />
                      </label>
                      <label>
                        <span className={labelClass}>Bucket 名称</span>
                        <input className={`${inputClass} mt-1.5 font-mono`} value={form.bucket_name} onChange={(e) => setForm((prev) => ({ ...prev, bucket_name: e.target.value }))} />
                      </label>
                      <label>
                        <span className={labelClass}>Region</span>
                        <input className={`${inputClass} mt-1.5`} value={form.region} placeholder="可选" onChange={(e) => setForm((prev) => ({ ...prev, region: e.target.value }))} />
                      </label>
                      <label>
                        <span className={labelClass}>Access Key</span>
                        <input className={`${inputClass} mt-1.5 font-mono`} value={form.access_key} onChange={(e) => setForm((prev) => ({ ...prev, access_key: e.target.value }))} />
                      </label>
                      <label>
                        <span className={labelClass}>Secret Key</span>
                        <input className={`${inputClass} mt-1.5 font-mono`} type="password" value={form.secret_key} onChange={(e) => setForm((prev) => ({ ...prev, secret_key: e.target.value }))} />
                      </label>
                      <label className="md:col-span-2">
                        <span className={labelClass}>公开访问域名</span>
                        <input className={`${inputClass} mt-1.5 font-mono`} value={form.public_domain} placeholder="用于复制 ISO 下载链接，可选" onChange={(e) => setForm((prev) => ({ ...prev, public_domain: e.target.value }))} />
                      </label>
                    </>
                  ) : (
                    <div className="md:col-span-2 space-y-3 rounded border border-orange-200 bg-orange-50 p-4">
                      <label className="block">
                        <span className={labelClass}>本地挂载路径</span>
                        <input
                          className={`${inputClass} mt-1.5 font-mono`}
                          value={localPath}
                          placeholder="例如: D:\\esxi-data\\storage 或 /data/esxi-builder/storage"
                          onChange={(e) => setLocalPath(e.target.value)}
                        />
                      </label>
                      <p className="text-[12px] leading-5 text-orange-700">
                        本地节点用于记录 Worker 可读写的目录路径。当前 API 仍以 S3/MinIO 节点为可执行构建源，本地节点需要后端文件服务和构建队列增加本地存储适配后才能启用。
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-5 border-t pt-4 text-sm text-gray-700">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.use_ssl} onChange={(e) => setForm((prev) => ({ ...prev, use_ssl: e.target.checked }))} />
                    使用 SSL
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={Boolean(form.is_default)} onChange={(e) => setForm((prev) => ({ ...prev, is_default: e.target.checked }))} />
                    设为默认存储
                  </label>
                  <div className="ml-auto flex gap-3">
                    <Dialog.Close asChild>
                      <button type="button" className={secondaryButton}>取消</button>
                    </Dialog.Close>
                    <button type="submit" className={primaryButton} disabled={createMutation.isPending}>
                      {storageType === 'local' ? '记录本地设置' : createMutation.isPending ? '保存中...' : '测试并保存'}
                    </button>
                  </div>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border border-gray-200 bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">存储节点</p>
          <p className="mt-2 text-2xl font-bold">{sortedBuckets.length}</p>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4 md:col-span-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">默认挂载</p>
          <p className="mt-2 truncate text-sm font-semibold text-blue-700">{defaultBucket ? `${defaultBucket.name} / ${defaultBucket.bucket_name}` : '尚未设置'}</p>
        </div>
      </div>

      {message && <div className="rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div>}
      {bucketsQuery.isError && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{String(bucketsQuery.error)}</div>}

      <div className="overflow-hidden rounded border border-gray-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="border-b border-gray-200 bg-[#f9f9fb] text-[11px] font-bold uppercase tracking-wider text-gray-600">
            <tr>
              <th className="px-4 py-3">名称</th>
              <th className="px-4 py-3">类型</th>
              <th className="px-4 py-3">地址 / Bucket</th>
              <th className="px-4 py-3">区域 / SSL</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bucketsQuery.isLoading && (
              <tr>
                <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={6}>正在加载存储节点...</td>
              </tr>
            )}
            {!bucketsQuery.isLoading && sortedBuckets.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={6}>暂无存储节点</td>
              </tr>
            )}
            {sortedBuckets.map((bucket) => (
              <tr key={bucket.id} className="text-[13px] hover:bg-[#f9f9fb]">
                <td className="px-4 py-3 font-semibold text-blue-700">{bucket.name}</td>
                <td className="px-4 py-3"><span className="rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">S3</span></td>
                <td className="px-4 py-3">
                  <div className="font-mono text-[12px] text-gray-700">{bucket.endpoint}</div>
                  <div className="font-mono text-[11px] text-gray-400">{bucket.bucket_name}</div>
                </td>
                <td className="px-4 py-3 text-gray-600">{bucket.region || '-'} / {bucket.use_ssl ? 'SSL' : 'Plain'}</td>
                <td className="px-4 py-3">
                  {bucket.is_default ? (
                    <span className="rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">默认</span>
                  ) : (
                    <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">可用</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button className={secondaryButton} onClick={() => testMutation.mutate(bucket.id)} disabled={testMutation.isPending}>测试</button>
                    {!bucket.is_default && <button className={secondaryButton} onClick={() => defaultMutation.mutate(bucket.id)} disabled={defaultMutation.isPending}>默认</button>}
                    <button className="rounded border border-red-200 bg-white px-3 py-1.5 text-[13px] font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => deleteMutation.mutate(bucket.id)} disabled={deleteMutation.isPending}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
