import * as Tabs from '@radix-ui/react-tabs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { listBuckets } from '../api/buckets'
import { deleteFile, listDepots, listDrivers, listISOs, refreshFiles, uploadFile } from '../api/files'
import { formatBytes, formatDate } from '../utils'

export default function FilesPage() {
  const queryClient = useQueryClient()
  const [bucketId, setBucketId] = useState<number | ''>('')
  const [version, setVersion] = useState('8.x')
  const [category, setCategory] = useState('network')
  const [message, setMessage] = useState<string | null>(null)

  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const selectedBucketId = useMemo(() => {
    if (typeof bucketId === 'number') return bucketId
    const first = bucketsQuery.data?.[0]
    return first?.id
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
      setMessage('File uploaded successfully')
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
      setMessage('File deleted')
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
      setMessage('Metadata refreshed from storage')
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
    uploadMutation.mutate({ type, file, esxiVersion: type === 'driver' ? version : undefined, driverCategory: type === 'driver' ? category : undefined })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">File Management</h1>
          <p className="text-sm text-gray-500">Upload depots, drivers, and generated ISOs.</p>
        </div>
        <div className="flex gap-3">
          <select className="rounded border px-3 py-2" value={selectedBucketId ?? ''} onChange={(e) => setBucketId(Number(e.target.value))}>
            {(bucketsQuery.data ?? []).map((bucket) => (
              <option key={bucket.id} value={bucket.id}>{bucket.name}</option>
            ))}
          </select>
          <button className="rounded border px-4 py-2" onClick={() => refreshMutation.mutate()} disabled={!selectedBucketId}>Refresh Metadata</button>
        </div>
      </div>

      {message && <div className="rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div>}

      <Tabs.Root defaultValue="depots" className="space-y-4">
        <Tabs.List className="flex gap-2 rounded bg-white p-1 shadow-sm">
          <Tabs.Trigger value="depots" className="rounded px-4 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Depot Files</Tabs.Trigger>
          <Tabs.Trigger value="drivers" className="rounded px-4 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">Drivers</Tabs.Trigger>
          <Tabs.Trigger value="isos" className="rounded px-4 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white">ISO Files</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="depots" className="space-y-4">
          <label className="inline-flex cursor-pointer rounded border bg-white px-4 py-2">
            <span>Upload Depot</span>
            <input className="hidden" type="file" onChange={(e) => handleUpload('depot', e.target.files?.[0])} />
          </label>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(depotsQuery.data ?? []).map((file) => (
              <div key={file.id} className="rounded border bg-white p-4">
                <div className="font-medium">{file.path.split('/').pop()}</div>
                <div className="mt-1 text-sm text-gray-500">{formatBytes(file.size)}</div>
              </div>
            ))}
          </div>
        </Tabs.Content>

        <Tabs.Content value="drivers" className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <select className="rounded border px-3 py-2" value={version} onChange={(e) => setVersion(e.target.value)}>
              <option value="7.x">7.x</option>
              <option value="8.x">8.x</option>
              <option value="9.x">9.x</option>
            </select>
            <select className="rounded border px-3 py-2" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="network">Network</option>
              <option value="storage">Storage</option>
              <option value="raid">RAID</option>
              <option value="backup">Backup</option>
            </select>
            <label className="inline-flex cursor-pointer rounded border bg-white px-4 py-2">
              <span>Upload Driver</span>
              <input className="hidden" type="file" onChange={(e) => handleUpload('driver', e.target.files?.[0])} />
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(driversQuery.data ?? []).map((file) => (
              <div key={file.id} className="rounded border bg-white p-4">
                <div className="font-medium">{file.driver_name || file.path.split('/').pop()}</div>
                <div className="text-sm text-gray-500">{file.driver_description || 'No description available'}</div>
                <div className="mt-2 text-xs text-gray-400">{file.driver_version || file.path}</div>
              </div>
            ))}
          </div>
        </Tabs.Content>

        <Tabs.Content value="isos" className="space-y-4">
          <label className="inline-flex cursor-pointer rounded border bg-white px-4 py-2">
            <span>Upload ISO</span>
            <input className="hidden" type="file" onChange={(e) => handleUpload('iso', e.target.files?.[0])} />
          </label>
          <div className="overflow-hidden rounded border bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-4 py-3">Filename</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(isoQuery.data ?? []).map((file) => {
                  const link = selectedBucket?.public_domain
                    ? `${selectedBucket.public_domain.replace(/\/$/, '')}/${selectedBucket.bucket_name}/${file.path}`
                    : file.path
                  return (
                    <tr key={file.id} className="border-t">
                      <td className="px-4 py-3">{file.path.split('/').pop()}</td>
                      <td className="px-4 py-3">{formatBytes(file.size)}</td>
                      <td className="px-4 py-3">{formatDate(file.last_modified)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button className="rounded border px-2 py-1" onClick={() => navigator.clipboard.writeText(link)}>Copy Link</button>
                          <button className="rounded border border-red-300 px-2 py-1 text-red-600" onClick={() => deleteMutation.mutate(file.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
