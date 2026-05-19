import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BuildPage from './BuildPage'

vi.mock('../api/buckets', () => ({
  listBuckets: vi.fn(async () => [
    {
      id: 1,
      name: 'Local Storage',
      type: 'local',
      endpoint: '',
      access_key: '',
      bucket_name: '',
      region: '',
      use_ssl: false,
      public_domain: '',
      local_path: 'D:/esxi',
      is_default: true,
      created_at: '2026-05-19T00:00:00Z',
    },
  ]),
}))

vi.mock('../api/files', () => ({
  listDepots: vi.fn(async () => [
    {
      id: 10,
      storage_bucket_id: 1,
      path: 'depot/ESXi-8.0U2-depot.zip',
      type: 'depot',
      esxi_version: '8.0',
      cached: true,
    },
  ]),
  listDrivers: vi.fn(async () => [
    {
      id: 20,
      storage_bucket_id: 1,
      path: 'drivers/net-community.vib',
      type: 'driver',
      esxi_version: '8.0',
      driver_name: 'net-community',
      driver_description: 'Realtek / Intel legacy NIC support',
      driver_version: '1.2.7',
      size: 18 * 1024 * 1024,
      cached: true,
    },
  ]),
}))

vi.mock('../api/builds', () => ({
  createBuild: vi.fn(),
  getBuildPreflight: vi.fn(async () => ({
    id: 'preflight-1',
    status: 'ready',
    progress: 100,
    files: [{ kind: 'depot', path: 'depot/ESXi-8.0U2-depot.zip', status: 'ready', progress: 100, cached: true }],
    image_profiles: [
      { name: 'ESXi-8.0U2-standard', vendor: 'VMware', acceptance_level: 'PartnerSupported' },
      { name: 'ESXi-8.0U2-no-tools', vendor: 'VMware', acceptance_level: 'PartnerSupported' },
    ],
    selected_image_profile: 'ESXi-8.0U2-standard',
    created_at: '2026-05-19T00:00:00Z',
    updated_at: '2026-05-19T00:00:01Z',
  })),
  startBuildPreflight: vi.fn(async () => ({
    id: 'preflight-1',
    status: 'running',
    progress: 0,
    files: [],
    created_at: '2026-05-19T00:00:00Z',
    updated_at: '2026-05-19T00:00:00Z',
  })),
}))

function renderBuildPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={client}>
      <BuildPage />
    </QueryClientProvider>
  )
}

describe('BuildPage interaction workbench', () => {
  it('renders the build workflow with Ant Design steps and source selection first', async () => {
    renderBuildPage()

    expect(await screen.findByText(/步骤驱动工作流/)).toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: '构建步骤' })).not.toBeInTheDocument()
    expect(screen.getAllByText('选择源文件').length).toBeGreaterThan(0)
    expect(screen.getByText('Depot 源文件')).toBeInTheDocument()
    expect(screen.getByText('当前配置')).toBeInTheDocument()
  })

  it('keeps driver selection on an Ant Design table with toolbar actions', async () => {
    renderBuildPage()

    expect((await screen.findAllByText('depot/ESXi-8.0U2-depot.zip')).length).toBeGreaterThan(0)
    fireEvent.click(await screen.findByRole('button', { name: /继续下一步/ }))

    expect(await screen.findByText('驱动选择')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('搜索驱动名称 / 供应商 / 文件名')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全选当前' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批量导入' })).toBeDisabled()
    const compatibilityHeader = screen.getByRole('columnheader', { name: '兼容性' })
    expect(compatibilityHeader).toBeInTheDocument()

    const table = compatibilityHeader.closest('table') as HTMLTableElement
    expect(within(table).getByRole('checkbox', { name: /Select all/i })).toBeInTheDocument()
    expect(await within(table).findByText('net-community')).toBeInTheDocument()
  })

  it('does not jump when clicking a later navigation step', async () => {
    const { container } = renderBuildPage()

    await waitFor(() => {
      expect(container.querySelectorAll('.build-navigation-steps .ant-steps-item')).toHaveLength(4)
    })
    const steps = container.querySelectorAll('.build-navigation-steps .ant-steps-item')
    expect(steps).toHaveLength(4)

    fireEvent.click(steps[2])

    expect(steps[0]).toHaveClass('ant-steps-item-process')
    expect(steps[2]).toHaveClass('ant-steps-item-wait')
  })

  it('uses compact build rows and truncation hooks for long text', async () => {
    const { container } = renderBuildPage()

    await waitFor(() => {
      expect(container.querySelector('.selected-source-strip')).toBeInTheDocument()
    })

    const nextButton = container.querySelector('.build-actions-card .ant-btn-primary')
    expect(nextButton).toBeInTheDocument()
    fireEvent.click(nextButton as HTMLElement)

    await waitFor(() => {
      expect(container.querySelector('.driver-title')).toBeInTheDocument()
      expect(container.querySelector('.driver-version')).toBeInTheDocument()
    })
  })

  it('lets users confirm the inspected image profile before building', async () => {
    const { container } = renderBuildPage()

    await waitFor(() => {
      expect(container.querySelector('.selected-source-strip')).toBeInTheDocument()
    })
    let nextButton = container.querySelector('.build-actions-card .ant-btn-primary')
    fireEvent.click(nextButton as HTMLElement)

    await waitFor(() => {
      expect(container.querySelector('.driver-title')).toBeInTheDocument()
    })
    nextButton = container.querySelector('.build-actions-card .ant-btn-primary')
    fireEvent.click(nextButton as HTMLElement)

    await waitFor(() => {
      expect(container.querySelector('.preflight-row')).toBeInTheDocument()
    })
    nextButton = container.querySelector('.build-actions-card .ant-btn-primary')
    fireEvent.click(nextButton as HTMLElement)

    await waitFor(() => {
      expect(container.querySelector('.build-image-profile-select')).toBeInTheDocument()
    })
  })
})
