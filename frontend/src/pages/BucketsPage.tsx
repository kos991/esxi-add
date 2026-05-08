import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useMemo, useState } from 'react'
import { createBucket, deleteBucket, listBuckets, setDefaultBucket, testBucketConnection, updateBucket, type BucketPayload } from '../api/buckets'
import type { StorageBucket } from '../types'

const initialForm: BucketPayload = {
  name: '',
  type: 's3',
  endpoint: '',
  access_key: '',
  secret_key: '',
  bucket_name: '',
  region: '',
  use_ssl: true,
  public_domain: '',
  local_path: '',
  is_default: false,
}

const inputClass = 'w-full rounded border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-600'
const labelClass = 'space-y-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500'
const primaryButton = 'rounded border border-[#0051c3] bg-[#0051c3] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#0043a5] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton = 'rounded border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60'
const dangerButton = 'rounded border border-red-200 bg-white px-3 py-1.5 text-[13px] font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60'

function bucketType(bucket: StorageBucket) {
  return bucket.type === 'local' ? 'local' : 's3'
}

function bucketLocation(bucket: StorageBucket) {
  return bucketType(bucket) === 'local' ? bucket.local_path || '-' : bucket.endpoint || '-'
}

function bucketSubLocation(bucket: StorageBucket) {
  return bucketType(bucket) === 'local' ? '本地挂载点' : bucket.bucket_name || '-'
}

export default function BucketsPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [storageType, setStorageType] = useState<'s3' | 'local'>('s3')
  const [localPath, setLocalPath] = useState('')
  const [form, setForm] = useState<BucketPayload>(initialForm)
  const [editingBucket, setEditingBucket] = useState<StorageBucket | null>(null)
  const [editStorageType, setEditStorageType] = useState<'s3' | 'local'>('s3')
  const [editForm, setEditForm] = useState<BucketPayload>(initialForm)
  const [editLocalPath, setEditLocalPath] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })

  const resetCreateForm = () => {
    setForm(initialForm)
    setStorageType('s3')
    setLocalPath('')
  }

  const createMutation = useMutation({
    mutationFn: createBucket,
    onSuccess: async () => {
      setMessage('存储节点已创建')
      resetCreateForm()
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['buckets'] })
    },
    onError: (error) => setMessage(String(error)),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: BucketPayload }) => updateBucket(id, data),
    onSuccess: async () => {
      setMessage('存储节点已更新')
      setEditingBucket(null)
      setEditStorageType('s3')
      setEditForm(initialForm)
      setEditLocalPath('')
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
      createMutation.mutate({
        name: form.name.trim(),
        type: 'local',
        local_path: localPath.trim(),
        is_default: form.is_default,
      })
      return
    }

    createMutation.mutate({
      ...form,
      name: form.name.trim(),
      type: 's3',
      local_path: '',
      use_ssl: form.use_ssl ?? true,
    })
  }

  const startEditMount = (bucket: StorageBucket) => {
    const type = bucketType(bucket)
    setEditingBucket(bucket)
    setEditStorageType(type)
    setEditForm({
      name: bucket.name,
      type,
      endpoint: bucket.endpoint || '',
      access_key: bucket.access_key || '',
      secret_key: bucket.secret_key || '',
      bucket_name: bucket.bucket_name || '',
      region: bucket.region || '',
      use_ssl: bucket.use_ssl,
      public_domain: bucket.public_domain || '',
      local_path: bucket.local_path || '',
      is_default: bucket.is_default,
    })
    setEditLocalPath(bucket.local_path || '')
    setMessage(null)
  }

  const submitMountEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingBucket) return

    if (editStorageType === 'local') {
      updateMutation.mutate({
        id: editingBucket.id,
        data: {
          name: editForm.name.trim(),
          type: 'local',
          endpoint: '',
          access_key: '',
          secret_key: '',
          bucket_name: '',
          region: '',
          use_ssl: true,
          public_domain: '',
          local_path: editLocalPath.trim(),
          is_default: editForm.is_default,
        },
      })
      return
    }

    updateMutation.mutate({
      id: editingBucket.id,
      data: {
        ...editForm,
        name: editForm.name.trim(),
        type: 's3',
        local_path: '',
        use_ssl: editForm.use_ssl ?? true,
      },
    })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-gray-500">
            账户 / <span className="font-bold text-gray-900">存储与挂载</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">存储与挂载</h1>
          <p className="text-sm text-gray-500">管理构建流程使用的 S3 兼容对象存储、R2 或本地目录节点。</p>
        </div>
        <Dialog.Root
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen)
            if (!nextOpen) resetCreateForm()
          }}
        >
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
                      onChange={(e) => {
                        const nextType = e.target.value as 's3' | 'local'
                        setStorageType(nextType)
                        setForm((prev) => ({ ...prev, type: nextType }))
                      }}
                    >
                      <option value="s3">S3 兼容对象存储 / R2</option>
                      <option value="local">容器本地目录</option>
                    </select>
                  </label>
                  <label>
                    <span className={labelClass}>节点显示名称</span>
                    <input className={`${inputClass} mt-1.5`} value={form.name} placeholder="例如: R2-esxi-build" onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
                  </label>
                  {storageType === 's3' ? (
                    <>
                      <label>
                        <span className={labelClass}>Endpoint 地址</span>
                        <input className={`${inputClass} mt-1.5 font-mono`} value={form.endpoint ?? ''} placeholder="https://account.r2.cloudflarestorage.com" onChange={(e) => setForm((prev) => ({ ...prev, endpoint: e.target.value }))} />
                      </label>
                      <label>
                        <span className={labelClass}>Bucket 名称</span>
                        <input className={`${inputClass} mt-1.5 font-mono`} value={form.bucket_name ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, bucket_name: e.target.value }))} />
                      </label>
                      <label>
                        <span className={labelClass}>Region</span>
                        <input className={`${inputClass} mt-1.5`} value={form.region ?? ''} placeholder="可选" onChange={(e) => setForm((prev) => ({ ...prev, region: e.target.value }))} />
                      </label>
                      <label>
                        <span className={labelClass}>Access Key</span>
                        <input className={`${inputClass} mt-1.5 font-mono`} value={form.access_key ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, access_key: e.target.value }))} />
                      </label>
                      <label>
                        <span className={labelClass}>Secret Key</span>
                        <input className={`${inputClass} mt-1.5 font-mono`} type="password" value={form.secret_key ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, secret_key: e.target.value }))} />
                      </label>
                      <label className="md:col-span-2">
                        <span className={labelClass}>公开访问域名</span>
                        <input className={`${inputClass} mt-1.5 font-mono`} value={form.public_domain ?? ''} placeholder="用于复制 ISO 下载链接，可选" onChange={(e) => setForm((prev) => ({ ...prev, public_domain: e.target.value }))} />
                      </label>
                    </>
                  ) : (
                    <label className="md:col-span-2">
                      <span className={labelClass}>本地挂载路径</span>
                      <input
                        className={`${inputClass} mt-1.5 font-mono`}
                        value={localPath}
                        placeholder="/data/esxi-builder/storage"
                        onChange={(e) => setLocalPath(e.target.value)}
                      />
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-5 border-t pt-4 text-sm text-gray-700">
                  {storageType === 's3' && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={Boolean(form.use_ssl)} onChange={(e) => setForm((prev) => ({ ...prev, use_ssl: e.target.checked }))} />
                      使用 SSL
                    </label>
                  )}
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={Boolean(form.is_default)} onChange={(e) => setForm((prev) => ({ ...prev, is_default: e.target.checked }))} />
                    设为默认存储
                  </label>
                  <div className="ml-auto flex gap-3">
                    <Dialog.Close asChild>
                      <button type="button" className={secondaryButton}>取消</button>
                    </Dialog.Close>
                    <button type="submit" className={primaryButton} disabled={createMutation.isPending}>
                      {createMutation.isPending ? '保存中...' : '保存节点'}
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
          <p className="mt-2 truncate text-sm font-semibold text-blue-700">
            {defaultBucket ? `${defaultBucket.name} / ${bucketLocation(defaultBucket)}` : '尚未设置'}
          </p>
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
              <th className="px-4 py-3">地址 / 挂载点</th>
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
            {sortedBuckets.map((bucket) => {
              const type = bucketType(bucket)
              return (
                <tr key={bucket.id} className="text-[13px] hover:bg-[#f9f9fb]">
                  <td className="px-4 py-3 font-semibold text-blue-700">{bucket.name}</td>
                  <td className="px-4 py-3">
                    <span className="rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-600">{type}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="break-all font-mono text-[12px] text-gray-700">{bucketLocation(bucket)}</div>
                    <div className="break-all font-mono text-[11px] text-gray-400">{bucketSubLocation(bucket)}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{type === 'local' ? '-' : `${bucket.region || '-'} / ${bucket.use_ssl ? 'SSL' : 'Plain'}`}</td>
                  <td className="px-4 py-3">
                    {bucket.is_default ? (
                      <span className="rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">默认</span>
                    ) : (
                      <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">可用</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button className={secondaryButton} onClick={() => testMutation.mutate(bucket.id)} disabled={testMutation.isPending}>测试</button>
                      <button className={secondaryButton} onClick={() => startEditMount(bucket)} disabled={updateMutation.isPending}>编辑</button>
                      {!bucket.is_default && <button className={secondaryButton} onClick={() => defaultMutation.mutate(bucket.id)} disabled={defaultMutation.isPending}>默认</button>}
                      <button
                        className={dangerButton}
                        onClick={() => {
                          if (window.confirm(`删除 ${bucket.name}？`)) deleteMutation.mutate(bucket.id)
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Dialog.Root
        open={Boolean(editingBucket)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setEditingBucket(null)
            setEditStorageType('s3')
            setEditForm(initialForm)
            setEditLocalPath('')
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b bg-gray-50 px-6 py-4">
              <Dialog.Title className="font-bold text-gray-950">编辑存储节点</Dialog.Title>
              <Dialog.Close className="text-xl leading-none text-gray-500 hover:text-gray-900" aria-label="关闭">
                &times;
              </Dialog.Close>
            </div>
            <form className="space-y-5 p-6" onSubmit={submitMountEdit}>
              <div className="grid gap-4 md:grid-cols-2">
                <label>
                  <span className={labelClass}>节点显示名称</span>
                  <input className={`${inputClass} mt-1.5`} value={editForm.name} onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))} />
                </label>
                <label>
                  <span className={labelClass}>存储类型</span>
                  <select
                    className={`${inputClass} mt-1.5 bg-white`}
                    value={editStorageType}
                    onChange={(e) => {
                      const nextType = e.target.value as 's3' | 'local'
                      setEditStorageType(nextType)
                      setEditForm((prev) => ({ ...prev, type: nextType }))
                    }}
                  >
                    <option value="s3">S3 兼容对象存储 / R2</option>
                    <option value="local">容器本地目录</option>
                  </select>
                </label>
                {editStorageType === 's3' ? (
                  <>
                    <label>
                      <span className={labelClass}>Endpoint 地址</span>
                      <input className={`${inputClass} mt-1.5 font-mono`} value={editForm.endpoint ?? ''} onChange={(e) => setEditForm((prev) => ({ ...prev, endpoint: e.target.value }))} />
                    </label>
                    <label>
                      <span className={labelClass}>Bucket 名称</span>
                      <input className={`${inputClass} mt-1.5 font-mono`} value={editForm.bucket_name ?? ''} onChange={(e) => setEditForm((prev) => ({ ...prev, bucket_name: e.target.value }))} />
                    </label>
                    <label>
                      <span className={labelClass}>Region</span>
                      <input className={`${inputClass} mt-1.5`} value={editForm.region ?? ''} placeholder="可选" onChange={(e) => setEditForm((prev) => ({ ...prev, region: e.target.value }))} />
                    </label>
                    <label>
                      <span className={labelClass}>Access Key</span>
                      <input className={`${inputClass} mt-1.5 font-mono`} value={editForm.access_key ?? ''} onChange={(e) => setEditForm((prev) => ({ ...prev, access_key: e.target.value }))} />
                    </label>
                    <label>
                      <span className={labelClass}>Secret Key</span>
                      <input className={`${inputClass} mt-1.5 font-mono`} type="password" value={editForm.secret_key ?? ''} onChange={(e) => setEditForm((prev) => ({ ...prev, secret_key: e.target.value }))} />
                    </label>
                    <label className="md:col-span-2">
                      <span className={labelClass}>公开访问域名</span>
                      <input className={`${inputClass} mt-1.5 font-mono`} value={editForm.public_domain ?? ''} placeholder="用于 ISO 下载链接，可选" onChange={(e) => setEditForm((prev) => ({ ...prev, public_domain: e.target.value }))} />
                    </label>
                  </>
                ) : (
                  <label className="md:col-span-2">
                    <span className={labelClass}>容器内本地路径</span>
                    <input className={`${inputClass} mt-1.5 font-mono`} value={editLocalPath} onChange={(e) => setEditLocalPath(e.target.value)} />
                  </label>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-5 border-t pt-4 text-sm text-gray-700">
                {editStorageType === 's3' && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={Boolean(editForm.use_ssl)} onChange={(e) => setEditForm((prev) => ({ ...prev, use_ssl: e.target.checked }))} />
                    使用 SSL
                  </label>
                )}
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(editForm.is_default)} onChange={(e) => setEditForm((prev) => ({ ...prev, is_default: e.target.checked }))} />
                  设为默认存储
                </label>
              </div>
              <div className="flex justify-end gap-3 border-t pt-4">
                <Dialog.Close asChild>
                  <button type="button" className={secondaryButton}>取消</button>
                </Dialog.Close>
                <button type="submit" className={primaryButton} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? '保存中...' : '保存节点'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
