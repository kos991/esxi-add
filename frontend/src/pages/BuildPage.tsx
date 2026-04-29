import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listBuckets } from '../api/buckets'
import { createBuild } from '../api/builds'
import { listDepots, listDrivers } from '../api/files'

export default function BuildPage() {
  const navigate = useNavigate()
  const [bucketId, setBucketId] = useState<number | ''>('')
  const [version, setVersion] = useState('8.x')
  const [depotPath, setDepotPath] = useState('')
  const [driverPaths, setDriverPaths] = useState<string[]>([])
  const [customISOName, setCustomISOName] = useState('')
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

  const groupedDrivers = useMemo(() => {
    const groups: Record<string, typeof driversQuery.data> = {}
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

  const submit = () => {
    if (!selectedBucketId || !depotPath) {
      setMessage('Please choose a bucket and depot file')
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Create Build</h1>
        <p className="text-sm text-gray-500">Select a bucket, depot, and drivers to start a new custom ISO build.</p>
      </div>

      {message && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>}

      <div className="grid gap-6 rounded-lg border bg-white p-6">
        <div className="grid gap-2">
          <label className="text-sm font-medium">1. Select bucket</label>
          <select className="rounded border px-3 py-2" value={selectedBucketId ?? ''} onChange={(e) => setBucketId(Number(e.target.value))}>
            {(bucketsQuery.data ?? []).map((bucket) => (
              <option key={bucket.id} value={bucket.id}>{bucket.name}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium">2. Select ESXi version</label>
          <select className="rounded border px-3 py-2" value={version} onChange={(e) => setVersion(e.target.value)}>
            <option value="7.x">7.x</option>
            <option value="8.x">8.x</option>
            <option value="9.x">9.x</option>
          </select>
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium">3. Select depot file</label>
          <select className="rounded border px-3 py-2" value={depotPath} onChange={(e) => setDepotPath(e.target.value)}>
            <option value="">Choose a depot</option>
            {(depotsQuery.data ?? []).map((file) => (
              <option key={file.id} value={file.path}>{file.path}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-3">
          <label className="text-sm font-medium">4. Select drivers</label>
          {Object.entries(groupedDrivers).map(([group, items]) => (
            <div key={group} className="rounded border p-4">
              <div className="mb-3 text-sm font-semibold capitalize text-gray-700">{group}</div>
              <div className="grid gap-2 md:grid-cols-2">
                {(items ?? []).map((driver) => (
                  <label key={driver.id} className="flex items-start gap-2 rounded border p-3 text-sm">
                    <input type="checkbox" checked={driverPaths.includes(driver.path)} onChange={() => toggleDriver(driver.path)} />
                    <span>
                      <span className="block font-medium">{driver.driver_name || driver.path.split('/').pop()}</span>
                      <span className="text-gray-500">{driver.driver_description || driver.path}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium">5. Optional custom ISO name</label>
          <input className="rounded border px-3 py-2" value={customISOName} onChange={(e) => setCustomISOName(e.target.value)} placeholder="custom-esxi.iso" />
        </div>

        <div>
          <button className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700" onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Submitting...' : 'Start Build'}
          </button>
        </div>
      </div>
    </div>
  )
}
