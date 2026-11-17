import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BuildPage from './BuildPage'
import { createBuild } from '../api/builds'
import { dedupeChineseLogs, formatLogToChinese } from './pipelineUtils'

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
      local_path: '/data/storage',
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
      size: 682757230,
    },
  ]),
  listISOs: vi.fn(async () => []),
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
    task_id: 'task-new',
    status: 'running',
    esxi_version: '8.0',
    depot_path: 'depots/8.0/VMware-ESXi-8.0U3k-depot.zip',
    drivers: '["drivers/net-community.vib"]',
    custom_iso_name: 'ESXi-8.0-custom-test.iso',
    progress: 10,
    log_output: '[TIMING] input_prepare_ms=120\n[PROGRESS] 10 building\n',
    created_at: '2026-11-13T08:00:00Z',
  })),
  deleteBuild: vi.fn(async () => ({ deleted: true, task_id: 'task-1' })),
  getBuild: vi.fn(async (id: string) => ({
    id: 1,
    task_id: id,
    status: 'running',
    esxi_version: '8.0',
    custom_iso_name: 'ESXi-8.0-custom-test.iso',
    drivers: '[]',
    progress: 10,
    log_output: '[TIMING] input_prepare_ms=120\n[PROGRESS] 10 building\n',
    created_at: '2026-11-13T08:00:00Z',
  })),
  listBuilds: vi.fn(async () => ({
    items: [
      {
        id: 9,
        task_id: 'history-task',
        status: 'completed',
        esxi_version: '7.0',
        custom_iso_name: 'history.iso',
        output_iso: 'output/history.iso',
        output_iso_size: 1024,
        build_duration: 12,
        drivers: '["drivers/old.vib"]',
        created_at: '2026-11-10T08:00:00Z',
      },
    ],
    page: 1,
    page_size: 30,
    total: 1,
  })),
  getBuildArtifactUrl: vi.fn((id: string) => `/api/builds/${id}/artifact`),
  getBuildPreflight: vi.fn(),
  startBuildPreflight: vi.fn(),
}))

function renderBuildPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <BuildPage />
    </QueryClientProvider>
  )
}

const nextBtn = () => screen.getByRole('button', { name: '下一步' })
const startBtn = () => screen.getByRole('button', { name: '开始构建' })

beforeEach(() => vi.clearAllMocks())

describe('构建流水线（分步引导）', () => {
  it('第 1 步显示安装源，且不把历史任务当成本次结果', async () => {
    renderBuildPage()

    expect(await screen.findByText('基础镜像')).toBeInTheDocument()
    expect((await screen.findAllByText(/VMware-ESXi-8\.0U3k-depot\.zip/)).length).toBeGreaterThan(0)
    expect(screen.getByText(/还没有构建任务/)).toBeInTheDocument()
    expect(screen.queryByText('task-new')).not.toBeInTheDocument()
    expect(screen.queryByText('history.iso')).not.toBeInTheDocument()
  })

  it('逐步走到第 4 步，提交真实驱动路径', async () => {
    renderBuildPage()

    await waitFor(() => expect(nextBtn()).toBeEnabled())
    fireEvent.click(nextBtn()) // → 第 2 步

    expect(await screen.findByText('驱动注入')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('net-community')).toBeInTheDocument())

    const row = screen.getByText('net-community').closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('checkbox'))
    await waitFor(() => expect(screen.getByLabelText('已选 1 个')).toBeInTheDocument())

    fireEvent.click(nextBtn()) // → 第 3 步
    expect(await screen.findByText('安装参数')).toBeInTheDocument()

    fireEvent.click(nextBtn()) // → 第 4 步
    expect(await screen.findByText('确认并运行')).toBeInTheDocument()
    expect(screen.getByText(/PowerCLI/)).toBeInTheDocument()

    fireEvent.click(startBtn())

    await waitFor(() => expect(createBuild).toHaveBeenCalled())
    const calls = (createBuild as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(calls[calls.length - 1]?.[0]).toEqual(
      expect.objectContaining({
        bucket_id: 1,
        esxi_version: '8.0',
        depot_path: 'depots/8.0/VMware-ESXi-8.0U3k-depot.zip',
        driver_paths: ['drivers/net-community.vib'],
        install_mode: 'unattended',
        boot_options: expect.arrayContaining(['hybrid_cpu', 'osdata_8g']),
      })
    )
  })

  it('提交后显示本次任务与中文日志', async () => {
    renderBuildPage()

    await waitFor(() => expect(nextBtn()).toBeEnabled())
    fireEvent.click(nextBtn())
    await screen.findByText('驱动注入')
    fireEvent.click(nextBtn())
    await screen.findByText('安装参数')
    fireEvent.click(nextBtn())
    await screen.findByText('确认并运行')
    fireEvent.click(startBtn())

    await waitFor(() => expect(screen.getByText('task-new')).toBeInTheDocument())
    expect(screen.getByText('task-new')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/输入准备：0\.12 秒/)).toBeInTheDocument())
  })

  it('第 1 步没有可用镜像源时不能进入下一步', async () => {
    const files = await import('../api/files')
    vi.mocked(files.listDepots).mockResolvedValueOnce([])
    renderBuildPage()

    await waitFor(() =>
      expect(screen.getByText(/暂无 ESXi 8\.0 的可用镜像源/)).toBeInTheDocument()
    )
    expect(nextBtn()).toBeDisabled()
  })
})

describe('中文日志解析', () => {
  it('错误优先于 xorriso 步骤匹配', () => {
    const parsed = formatLogToChinese('xorriso : FAILURE : Cannot open drive')
    expect(parsed?.kind).toBe('error')
    expect(parsed?.chinese).toContain('xorriso')
  })

  it('同一阶段别名只保留一条，原始日志仍完整', () => {
    const raw = ['[TIMING] driver_injection_ms=500', '[TIMING] driver_inject_ms=500']
    const parsed = dedupeChineseLogs(raw.map(formatLogToChinese))
    expect(parsed.filter((p) => p.chinese.includes('驱动与参数注入'))).toHaveLength(1)
    expect(parsed[0]?.raw).toBe(raw[0])
  })

  it('常见英文行会翻译成中文语义', () => {
    expect(formatLogToChinese('Using base ISO: /data/a.iso')?.chinese).toContain('实际使用的基础镜像')
    expect(formatLogToChinese('Injected VIB: vmw.vib')?.chinese).toContain('已注入 VIB')
    expect(formatLogToChinese('Patching BOOT.CFG and generating KS.CFG...')?.kind).toBe('step')
  })
})
