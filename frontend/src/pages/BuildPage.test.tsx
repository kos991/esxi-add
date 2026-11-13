import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
      path: 'depots/8.0/VMware-ESXi-8.0U3k-depot.zip',
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
  createBuild: vi.fn(async () => ({
    id: 1,
    task_id: 'task-test-pipeline',
    status: 'running',
    esxi_version: '8.0',
    depot_path: 'depots/8.0/VMware-ESXi-8.0U3k-depot.zip',
    drivers: '["drivers/net-community.vib"]',
    custom_iso_name: 'ESXi-8.0-custom-test.iso',
    root_password: 'niuniu',
    install_mode: 'unattended',
    progress: 50,
    log_output: '[TIMING] input_prepare_ms=45\n[PROGRESS] 50 building\n',
    created_at: '2026-11-13T08:00:00Z',
  })),
  deleteBuild: vi.fn(async () => ({ deleted: true, task_id: 'task-1' })),
  getBuild: vi.fn(async (id: string) => ({
    id: 1,
    task_id: id,
    status: 'running',
    esxi_version: '8.0',
    custom_iso_name: 'ESXi-8.0-custom-test.iso',
    progress: 50,
    log_output: '[TIMING] input_prepare_ms=45\n[PROGRESS] 50 building\n',
    created_at: '2026-11-13T08:00:00Z',
  })),
  listBuilds: vi.fn(async () => ({
    items: [
      {
        id: 1,
        task_id: 'task-test-pipeline',
        status: 'completed',
        esxi_version: '8.0',
        custom_iso_name: 'ESXi-8.0-custom-20261114.iso',
        output_iso: 'output/ESXi-8.0-custom-20261114.iso',
        output_iso_size: 489428992,
        build_duration: 7,
        created_at: '2026-11-13T08:00:00Z',
      },
    ],
    page: 1,
    page_size: 10,
    total: 1,
  })),
  getBuildArtifactUrl: vi.fn((id: string) => `/api/builds/${id}/artifact`),
  getBuildPreflight: vi.fn(),
  startBuildPreflight: vi.fn(),
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

describe('BuildPage 2-stage pipeline layout', () => {
  it('renders pipeline topology and Chinese output logs section', async () => {
    renderBuildPage()

    expect(await screen.findByText('流水线架构构成')).toBeInTheDocument()
    expect(screen.getByText('基础镜像源')).toBeInTheDocument()
    expect(screen.getByText(/社区驱动注入/)).toBeInTheDocument()
    expect(screen.getByText('安装参数与命名')).toBeInTheDocument()
    expect(screen.getByText('执行重封装')).toBeInTheDocument()
    expect(screen.getByText('中文解析项')).toBeInTheDocument()
  })

  it('filters drivers and handles selection toggle', async () => {
    renderBuildPage()

    await waitFor(() => {
      expect(screen.getByText('net-community')).toBeInTheDocument()
    })

    expect(screen.getByPlaceholderText('搜索驱动包...')).toBeInTheDocument()
  })

  it('runs pipeline and updates Chinese terminal logs', async () => {
    renderBuildPage()

    await waitFor(() => {
      expect(screen.getByText('运行构建流水线')).toBeInTheDocument()
    })

    const runBtn = screen.getByText('运行构建流水线')
    fireEvent.click(runBtn)

    await waitFor(() => {
      expect(screen.getByText(/基础镜像源与输入参数校验准备完成/)).toBeInTheDocument()
    })
  })
})
