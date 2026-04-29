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

export default function BucketsPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<BucketPayload>(initialForm)
  const [message, setMessage] = useState<string | null>(null)

  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })

  const createMutation = useMutation({
    mutationFn: createBucket,
    onSuccess: async () => {
      setMessage('Bucket created successfully')
      setForm(initialForm)
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['buckets'] })
    },
    onError: (error) => setMessage(String(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteBucket,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['buckets'] }),
    onError: (error) => setMessage(String(error)),
  })

  const defaultMutation = useMutation({
    mutationFn: setDefaultBucket,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['buckets'] }),
    onError: (error) => setMessage(String(error)),
  })

  const testMutation = useMutation({
    mutationFn: testBucketConnection,
    onSuccess: () => setMessage('Connection test succeeded'),
    onError: (error) => setMessage(String(error)),
  })

  const sortedBuckets = useMemo(
    () => [...(bucketsQuery.data ?? [])].sort((a, b) => Number(b.is_default) - Number(a.is_default)),
    [bucketsQuery.data]
  )

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    createMutation.mutate(form)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Storage Buckets</h1>
          <p className="text-sm text-gray-500">Manage S3 or MinIO connections used by the builder.</p>
        </div>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <button className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">+ Add Bucket</button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/40" />
            <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-lg">
              <Dialog.Title className="text-lg font-semibold">Add Storage Bucket</Dialog.Title>
              <form className="mt-4 grid grid-cols-2 gap-4" onSubmit={onSubmit}>
                {[
                  ['name', 'Name'],
                  ['endpoint', 'Endpoint'],
                  ['access_key', 'Access Key'],
                  ['secret_key', 'Secret Key'],
                  ['bucket_name', 'Bucket Name'],
                  ['region', 'Region'],
                  ['public_domain', 'Public Domain'],
                ].map(([key, label]) => (
                  <label key={key} className="flex flex-col gap-1 text-sm">
                    <span>{label}</span>
                    <input
                      className="rounded border px-3 py-2"
                      value={form[key as keyof BucketPayload] as string}
                      onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                  </label>
                ))}
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.use_ssl}
                    onChange={(e) => setForm((prev) => ({ ...prev, use_ssl: e.target.checked }))}
                  />
                  Use SSL
                </label>
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(form.is_default)}
                    onChange={(e) => setForm((prev) => ({ ...prev, is_default: e.target.checked }))}
                  />
                  Set as default bucket
                </label>
                <div className="col-span-2 flex justify-end gap-3">
                  <Dialog.Close asChild>
                    <button type="button" className="rounded border px-4 py-2">Cancel</button>
                  </Dialog.Close>
                  <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white" disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Saving...' : 'Save Bucket'}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      {message && <div className="rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div>}
      {bucketsQuery.isLoading && <div className="text-sm text-gray-500">Loading buckets...</div>}
      {bucketsQuery.isError && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{String(bucketsQuery.error)}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sortedBuckets.map((bucket) => (
          <div key={bucket.id} className="rounded-lg border bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-900">{bucket.name}</h2>
                <p className="text-sm text-gray-500">{bucket.endpoint}</p>
              </div>
              {bucket.is_default && <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">Default</span>}
            </div>
            <dl className="space-y-1 text-sm text-gray-600">
              <div><span className="font-medium">Bucket:</span> {bucket.bucket_name}</div>
              <div><span className="font-medium">Region:</span> {bucket.region || '-'}</div>
              <div><span className="font-medium">Public domain:</span> {bucket.public_domain || '-'}</div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded border px-3 py-1.5 text-sm" onClick={() => testMutation.mutate(bucket.id)}>Test</button>
              {!bucket.is_default && (
                <button className="rounded border px-3 py-1.5 text-sm" onClick={() => defaultMutation.mutate(bucket.id)}>Set Default</button>
              )}
              <button className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600" onClick={() => deleteMutation.mutate(bucket.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
