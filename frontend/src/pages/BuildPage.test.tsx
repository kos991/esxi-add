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
  createBuild: vi.fn(async () => ({
    id: 1,
    task_id: 'task-test-123',
    status: 'running',
    esxi_version: '8.0',
    depot_path: 'depot/ESXi-8.0U2-depot.zip',
    drivers: '["drivers/net-community.vib"]',
    custom_iso_name: 'ESXi-8.0-custom-test.iso',
    root_password: 'niuniu',
    install_mode: 'unattended',
    progress: 50,
    log_output: '[TIMING] input_prepare_ms=0\n[PROGRESS] 50 building\n',
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
    log_output: '[TIMING] input_prepare_ms=0\n[PROGRESS] 50 building\n',
    created_at: '2026-11-13T08:00:00Z',
  })),
  listBuilds: vi.fn(async () => ({
    items: [
      {
        id: 1,
        task_id: 'task-test-123',
        status: 'completed',
        esxi_version: '8.0',
        custom_iso_name: 'ESXi-8.0-custom-20261113.iso',
        output_iso: 'output/ESXi-8.0-custom-20261113.iso',
        output_iso_size: 489428992,
        build_duration: 9,
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

describe('BuildPage unified workbench', () => {
  it('renders the unified build workbench with configuration and tasks console', async () => {
    renderBuildPage()

    expect(await screen.findByText('新建定制构建配置')).toBeInTheDocument()
    expect(screen.getByText('Linux 原生极速引擎 (5~10 秒)')).toBeInTheDocument()
    expect(screen.getByText('基础镜像源文件 (ISO / Depot)')).toBeInTheDocument()
    expect(screen.getByText('构建任务控制台与实时日志')).toBeInTheDocument()
    expect(screen.getByText('近期构建任务')).toBeInTheDocument()
  })

  it('keeps driver selection table with search and select-all actions', async () => {
    renderBuildPage()

    expect(await screen.findByText('全选当前')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('搜索驱动')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('net-community')).toBeInTheDocument()
    })
  })

  it('provides custom iso name placeholder and core parameter adjustments', async () => {
    renderBuildPage()

    expect(await screen.findByText(/核心安装参数调整/)).toBeInTheDocument()
    expect(screen.getByText(/无人值守自动安装/)).toBeInTheDocument()
    expect(screen.getByText(/交互式手动安装/)).toBeInTheDocument()
  })

  it('submits build and updates active task console', async () => {
    renderBuildPage()

    await waitFor(() => {
      expect(screen.getByText('开始极速构建')).toBeInTheDocument()
    })

    const submitBtn = screen.getByText('开始极速构建')
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText('构建任务控制台与实时日志')).toBeInTheDocument()
    })
  })
})
