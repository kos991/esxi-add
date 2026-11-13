import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  TranslationOutlined,
} from '@ant-design/icons'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Popconfirm,
  Progress,
  Radio,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom'
import { listBuckets } from '../api/buckets'
import {
  createBuild,
  deleteBuild,
  getBuild,
  getBuildArtifactUrl,
  getBuildPreflight,
  listBuilds,
  startBuildPreflight,
} from '../api/builds'
import { listDepots, listDrivers } from '../api/files'
import { PhaseTimingBreakdown } from '../components/TaskWorkspace'
import { PageContainer } from '../components/pro-compat'
import { useWebSocket } from '../hooks/useWebSocket'
import type { BuildTask, FileMetadata } from '../types'
import { buildPublicObjectUrl, formatDate, parseDrivers } from '../utils'
import {
  BuildStatusTag,
  cacheStatusColor,
  cacheStatusText,
  compactSize,
  esxiVersions,
  fileName,
  formatLogToChinese,
} from './pipelineUtils'

type DepotOption = {
  key: string
  bucketId: number
  bucketName: string
  bucketType: 'local' | 's3'
  file: FileMetadata
}

type LogViewMode = 'chinese' | 'raw'
type LogFilterType = 'all' | 'issues'

function depotKey(bucketId: number, file: FileMetadata) {
  return `${bucketId}:${file.id}:${file.path}`
}

export default function BuildPage() {
  const queryClient = useQueryClient()
  const [messageApi, contextHolder] = message.useMessage()
  const [form] = Form.useForm()
  const logTerminalRef = useRef<HTMLDivElement>(null)

  const inRouter = useInRouterContext()
  const routerLocation = inRouter ? useLocation() : null
  const routerNavigate = inRouter ? useNavigate() : null

  const searchParams = useMemo(() => {
    const raw = routerLocation ? routerLocation.search : window.location.search
    return new URLSearchParams(raw)
  }, [routerLocation])

  const go = (path: string) => {
    if (routerNavigate) {
      routerNavigate(path)
    } else {
      window.location.assign(path)
    }
  }

  // Pipeline Recipe Configuration State
  const [version, setVersion] = useState<string>(() => searchParams.get('version') || '8.0')
  const [bucketId, setBucketId] = useState<number | undefined>(() => {
    const b = searchParams.get('bucket')
    return b ? Number(b) : undefined
  })
  const [depotPath, setDepotPath] = useState<string>(() => searchParams.get('depot') || '')
  const [driverPaths, setDriverPaths] = useState<string[]>([])
  const [installMode, setInstallMode] = useState<'unattended' | 'interactive'>('unattended')

  // Drivers Filter
  const [driverSearch, setDriverSearch] = useState('')
  const [driverFilter, setDriverFilter] = useState<'all' | 'match' | 'attention'>('all')

  // Preflight
  const [preflightId, setPreflightId] = useState<string | null>(null)

  // Active Task & Log Console State
  const [activeTaskId, setActiveTaskId] = useState<string | null>(() => searchParams.get('task'))
  const [logViewMode, setLogViewMode] = useState<LogViewMode>('chinese')
  const [logFilter, setLogFilter] = useState<LogFilterType>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false)

  // Sync with URL params
  useEffect(() => {
    const urlTask = searchParams.get('task')
    if (urlTask) setActiveTaskId(urlTask)
    const urlBucket = searchParams.get('bucket')
    const urlDepot = searchParams.get('depot')
    const urlVersion = searchParams.get('version')
    if (urlVersion) setVersion(urlVersion)
    if (urlBucket) setBucketId(Number(urlBucket))
    if (urlDepot) setDepotPath(urlDepot)
  }, [searchParams])

  // Query: Storage Buckets & Depots
  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const buckets = bucketsQuery.data ?? []
  const depotQueries = useQueries({
    queries: buckets.map((bucket) => ({
      queryKey: ['build-depots', bucket.id, version],
      queryFn: () => listDepots(bucket.id, version),
      enabled: Boolean(bucket.id),
    })),
  })

  const depotOptions = useMemo<DepotOption[]>(
    () =>
      buckets.flatMap((bucket, index) =>
        (depotQueries[index]?.data ?? []).map((file) => ({
          key: depotKey(bucket.id, file),
          bucketId: bucket.id,
          bucketName: bucket.name,
          bucketType: bucket.type === 'local' ? 'local' : 's3',
          file,
        }))
      ),
    [buckets, depotQueries]
  )

  const selectedBucketId = bucketId ?? buckets.find((b) => b.is_default)?.id ?? buckets[0]?.id
  const selectedBucket = buckets.find((b) => b.id === selectedBucketId)

  // Query: Drivers
  const driversQuery = useQuery({
    queryKey: ['build-drivers', selectedBucketId, version],
    queryFn: () => listDrivers(selectedBucketId as number, version),
    enabled: Boolean(selectedBucketId),
  })
  const selectedDepot = depotOptions.find(
    (item) => item.bucketId === selectedBucketId && item.file.path === depotPath
  )
  const drivers = driversQuery.data ?? []
  const selectedDrivers = useMemo(
    () => drivers.filter((file) => driverPaths.includes(file.path)),
    [drivers, driverPaths]
  )

  // Auto-pick first available depot
  useEffect(() => {
    if (!depotPath && depotOptions.length > 0) {
      setBucketId(depotOptions[0].bucketId)
      setDepotPath(depotOptions[0].file.path)
    }
  }, [depotOptions, depotPath])

  // Preflight
  const preflightQuery = useQuery({
    queryKey: ['build-preflight', preflightId],
    queryFn: () => getBuildPreflight(preflightId!),
    enabled: Boolean(preflightId),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1200 : false),
    refetchIntervalInBackground: false,
  })

  const preflightMutation = useMutation({
    mutationFn: startBuildPreflight,
    onSuccess: (res) => {
      setPreflightId(res.id)
      messageApi.info('已启动源镜像与驱动完整性预检')
    },
    onError: (err) => messageApi.error(String(err)),
  })

  // Recent Pipeline Tasks
  const recentBuildsQuery = useQuery({
    queryKey: ['builds-recent'],
    queryFn: () => listBuilds(1, 20),
    refetchInterval: (query) => {
      const hasRunning = (query.state.data?.items ?? []).some(
        (t) => t.status === 'running' || t.status === 'pending'
      )
      return hasRunning ? 2000 : 8000
    },
    refetchIntervalInBackground: false,
  })
  const recentBuilds = recentBuildsQuery.data?.items ?? []

  // Auto-select latest task
  useEffect(() => {
    if (!activeTaskId && recentBuilds.length > 0) {
      setActiveTaskId(recentBuilds[0].task_id)
    }
  }, [activeTaskId, recentBuilds])

  // Active Task Detail & WebSocket
  const activeTaskQuery = useQuery({
    queryKey: ['build-active', activeTaskId],
    queryFn: () => getBuild(activeTaskId!),
    enabled: Boolean(activeTaskId),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' || query.state.data?.status === 'pending' ? 1000 : false,
    refetchIntervalInBackground: false,
  })
  const activeTask = activeTaskQuery.data ?? recentBuilds.find((t) => t.task_id === activeTaskId)
  const activeTaskBucket = useMemo(
    () => buckets.find((b) => b.id === activeTask?.storage_bucket_id),
    [buckets, activeTask?.storage_bucket_id]
  )
  const { logs: wsLogs, progress: wsProgress } = useWebSocket(activeTaskId ?? null)

  const rawLogs = useMemo(() => {
    if (wsLogs && wsLogs.length > 0) return wsLogs
    return activeTask?.log_output ? activeTask.log_output.split('\n').filter(Boolean) : []
  }, [wsLogs, activeTask?.log_output])

  // Parsed Chinese Logs
  const chineseLogs = useMemo(() => {
    return rawLogs.map((line) => formatLogToChinese(line))
  }, [rawLogs])

  const filteredChineseLogs = useMemo(() => {
    if (logFilter === 'all') return chineseLogs
    return chineseLogs.filter((item) => item.kind === 'error' || item.kind === 'warn')
  }, [chineseLogs, logFilter])

  const filteredRawLogs = useMemo(() => {
    if (logFilter === 'all') return rawLogs
    return rawLogs.filter((l) => {
      const lower = l.toLowerCase()
      return lower.includes('error') || lower.includes('failed') || lower.includes('warn')
    })
  }, [rawLogs, logFilter])

  const displayProgress = wsProgress || activeTask?.progress || 0

  useEffect(() => {
    if (autoScroll && logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight
    }
  }, [filteredChineseLogs, filteredRawLogs, autoScroll, activeTaskId])

  // Mutation: Trigger Pipeline
  const createMutation = useMutation({
    mutationFn: createBuild,
    onSuccess: (task) => {
      setActiveTaskId(task.task_id)
      setLogFilter('all')
      messageApi.success('流水线已启动！下方实时输出中文构建日志')
      queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
    },
    onError: (err) => messageApi.error(String(err)),
  })

  // Mutation: Delete Task
  const deleteMutation = useMutation({
    mutationFn: deleteBuild,
    onSuccess: (_, deletedId) => {
      messageApi.success('任务记录已删除')
      if (activeTaskId === deletedId) setActiveTaskId(null)
      queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
    },
    onError: (err) => messageApi.error(String(err)),
  })

  // Driver Table logic
  const driverIsAttention = (file: FileMetadata) =>
    Boolean(file.conflicts_with || file.depends_on || file.cache_status === 'missing')

  const filteredDrivers = useMemo(() => {
    const kw = driverSearch.trim().toLowerCase()
    return drivers.filter((d) => {
      const matchKw =
        !kw ||
        d.path.toLowerCase().includes(kw) ||
        (d.driver_name && d.driver_name.toLowerCase().includes(kw)) ||
        (d.driver_description && d.driver_description.toLowerCase().includes(kw))
      const matchFilter =
        driverFilter === 'all' ||
        (driverFilter === 'match' && !driverIsAttention(d)) ||
        (driverFilter === 'attention' && driverIsAttention(d))
      return matchKw && matchFilter
    })
  }, [drivers, driverSearch, driverFilter])

  const allDriversSelected =
    filteredDrivers.length > 0 && filteredDrivers.every((d) => driverPaths.includes(d.path))

  const driverColumns: ColumnsType<FileMetadata> = [
    {
      title: '驱动包名称',
      key: 'name',
      render: (_, file) => (
        <div className="table-cell-stack">
          <Typography.Text strong className="driver-title">
            {file.driver_name || fileName(file)}
          </Typography.Text>
          <Typography.Text type="secondary" className="mono" ellipsis={{ tooltip: file.path }} style={{ fontSize: 11 }}>
            {file.driver_description || file.path}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '版本',
      dataIndex: 'driver_version',
      width: 90,
      render: (v) => <span className="mono tabular-nums">{v || '-'}</span>,
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 80,
      render: (v) => <span className="mono tabular-nums">{compactSize(v)}</span>,
    },
    {
      title: '匹配状态',
      key: 'compatibility',
      width: 86,
      render: (_, file) =>
        driverIsAttention(file) ? <Tag color="warning">需确认</Tag> : <Tag color="success">已匹配</Tag>,
    },
  ]

  const nowTimestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const formulaPlaceholder = `ESXi-${version}-custom-${nowTimestamp}.iso`

  const runPipeline = () => {
    if (!depotPath || !selectedBucketId) {
      messageApi.warning('请先在第 1 步选择基础镜像源 (ISO 或 Depot)')
      return
    }
    form.validateFields().then((values) => {
      createMutation.mutate({
        bucket_id: selectedBucketId,
        esxi_version: version,
        depot_path: depotPath,
        driver_paths: driverPaths,
        custom_iso_name: values.custom_iso_name ? values.custom_iso_name.trim() : undefined,
        root_password: values.root_password ? values.root_password.trim() : 'niuniu',
        install_mode: installMode,
      })
    })
  }

  const remoteArtifactUrl =
    activeTask?.output_iso && activeTaskBucket?.public_domain
      ? buildPublicObjectUrl(activeTaskBucket.public_domain, activeTask.output_iso)
      : undefined

  const isRunning = activeTask?.status === 'running' || activeTask?.status === 'pending'

  return (
    <PageContainer
      title="构建流水线"
      subTitle="上部编排流水线构成与驱动参数，下部原地输出全中文实时构建日志与成品 ISO 下载"
      extra={[
        <Button
          key="history-btn"
          icon={<HistoryOutlined />}
          onClick={() => setHistoryDrawerOpen(true)}
        >
          历史流水线 ({recentBuilds.length})
        </Button>,
        <Button
          key="storage-link"
          icon={<CloudUploadOutlined />}
          onClick={() => go('/storage')}
        >
          存储与挂载
        </Button>,
      ]}
    >
      {contextHolder}

      <div className="pipeline-page-flow">
        {/* ========================================================
            PART 1: PIPELINE TOPOLOGY & CONFIGURATION (上面流水线构成)
            ======================================================== */}
        <section className="pipeline-composer-section" aria-label="流水线构成编排">
          <div className="pipeline-section-bar">
            <Space size={8} wrap align="center">
              <span className="pipeline-pulse-dot" />
              <Typography.Title level={5} style={{ margin: 0 }}>
                流水线架构构成
              </Typography.Title>
              <Tag color="geekblue" className="engine-chip">
                <ThunderboltOutlined /> Linux 原生重封装 (5~10 秒)
              </Tag>
              {selectedDepot?.bucketType === 's3' && (
                <Tag color="cyan">已绑定 S3 挂载存储: {selectedDepot.bucketName}</Tag>
              )}
            </Space>
            <Space size={8}>
              <Button
                type="primary"
                size="middle"
                icon={<PlayCircleOutlined />}
                loading={createMutation.isPending || isRunning}
                onClick={runPipeline}
                className="pipeline-run-main-btn"
              >
                {isRunning ? '流水线执行中...' : '🚀 运行构建流水线'}
              </Button>
            </Space>
          </div>

          <Form
            form={form}
            layout="vertical"
            initialValues={{
              custom_iso_name: '',
              root_password: 'niuniu',
            }}
          >
            {/* Visual Pipeline 4-Stage Card Grid */}
            <div className="pipeline-stages-grid">
              {/* STAGE 1: Base Image */}
              <div className="pipeline-stage-card">
                <div className="stage-card-header">
                  <div className="stage-step-badge">1</div>
                  <div className="stage-header-title">
                    <strong>基础镜像源</strong>
                    <span>官方原版 ISO / Depot</span>
                  </div>
                </div>

                <div className="stage-card-body">
                  <Form.Item label="目标 ESXi 版本" style={{ marginBottom: 8 }}>
                    <Segmented
                      block
                      size="small"
                      value={version}
                      onChange={(v) => {
                        setVersion(String(v))
                        setDepotPath('')
                        setDriverPaths([])
                        setPreflightId(null)
                      }}
                      options={esxiVersions.map((v) => ({ value: v, label: `ESXi ${v}` }))}
                    />
                  </Form.Item>

                  <Form.Item label="选择基础镜像文件" required style={{ marginBottom: 6 }}>
                    <Select
                      showSearch
                      value={selectedDepot?.key}
                      placeholder="选择已有的基础 ISO 或 Depot"
                      loading={bucketsQuery.isLoading || depotQueries.some((q) => q.isLoading)}
                      onChange={(val) => {
                        const opt = depotOptions.find((o) => o.key === val)
                        setBucketId(opt?.bucketId)
                        setDepotPath(opt?.file.path ?? '')
                        setPreflightId(null)
                      }}
                      optionFilterProp="label"
                      notFoundContent={
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`无 ESXi ${version} 源`}>
                          <Button size="small" type="primary" onClick={() => go('/storage')}>
                            去存储库上传
                          </Button>
                        </Empty>
                      }
                      options={depotOptions.map((item) => ({
                        value: item.key,
                        label: `[${item.bucketName}] ${fileName(item.file)}`,
                      }))}
                    />
                  </Form.Item>

                  {selectedDepot && (
                    <div className="stage-source-summary">
                      <div className="source-row">
                        <Tag color={selectedDepot.bucketType === 's3' ? 'cyan' : 'blue'}>
                          {selectedDepot.bucketType === 's3' ? 'S3 挂载' : '本地存储'} · {selectedDepot.bucketName}
                        </Tag>
                        <Tag color={cacheStatusColor(selectedDepot.file, selectedBucket)}>
                          {cacheStatusText(selectedDepot.file, selectedBucket)}
                        </Tag>
                        {selectedDepot.file.size ? (
                          <span className="mono tabular-nums" style={{ fontSize: 11, color: '#475569' }}>
                            {compactSize(selectedDepot.file.size)}
                          </span>
                        ) : null}
                      </div>
                      <Typography.Text code className="mono" ellipsis={{ tooltip: selectedDepot.file.path }} style={{ fontSize: 11, display: 'block', marginTop: 3 }}>
                        {selectedDepot.file.path}
                      </Typography.Text>
                    </div>
                  )}

                  {selectedDepot && (
                    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        size="small"
                        type="link"
                        icon={<SafetyCertificateOutlined />}
                        loading={preflightMutation.isPending}
                        onClick={() => {
                          if (!selectedBucketId || !depotPath) return
                          preflightMutation.mutate({
                            bucket_id: selectedBucketId,
                            depot_path: depotPath,
                            driver_paths: driverPaths,
                          })
                        }}
                      >
                        预检源文件完整性
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* STAGE 2: Community Driver Injection */}
              <div className="pipeline-stage-card">
                <div className="stage-card-header">
                  <div className="stage-step-badge">2</div>
                  <div className="stage-header-title">
                    <strong>社区驱动注入</strong>
                    <span>网卡 / 存储 / NVMe 驱动</span>
                  </div>
                  <Tag color={selectedDrivers.length > 0 ? 'processing' : 'default'} style={{ marginInlineEnd: 0 }}>
                    已勾选 {selectedDrivers.length} 项
                  </Tag>
                </div>

                <div className="stage-card-body">
                  <div className="driver-toolbar-mini">
                    <Input
                      size="small"
                      allowClear
                      prefix={<SearchOutlined />}
                      placeholder="搜索驱动包..."
                      value={driverSearch}
                      onChange={(e) => setDriverSearch(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <Button
                      size="small"
                      onClick={() => {
                        const paths = filteredDrivers.map((d) => d.path)
                        if (allDriversSelected) {
                          setDriverPaths(driverPaths.filter((p) => !paths.includes(p)))
                        } else {
                          setDriverPaths(Array.from(new Set([...driverPaths, ...paths])))
                        }
                      }}
                    >
                      {allDriversSelected ? '取消' : '全选'}
                    </Button>
                  </div>

                  {selectedDrivers.length > 0 && (
                    <div className="selected-drivers-box">
                      {selectedDrivers.map((d) => (
                        <Tag
                          key={d.path}
                          color="blue"
                          closable
                          onClose={() => setDriverPaths(driverPaths.filter((p) => p !== d.path))}
                        >
                          {d.driver_name || fileName(d)}
                        </Tag>
                      ))}
                    </div>
                  )}

                  <Table
                    size="small"
                    rowKey="path"
                    bordered
                    pagination={false}
                    scroll={{ y: 130 }}
                    loading={driversQuery.isLoading}
                    dataSource={filteredDrivers}
                    columns={driverColumns}
                    className="compact-driver-table"
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前版本暂无可选驱动（可不选直接构建）" /> }}
                    rowSelection={{
                      selectedRowKeys: driverPaths,
                      onChange: (keys) => setDriverPaths(keys as string[]),
                    }}
                    onRow={(rec) => ({
                      style: { cursor: 'pointer' },
                      onClick: () => {
                        setDriverPaths((prev) =>
                          prev.includes(rec.path) ? prev.filter((p) => p !== rec.path) : [...prev, rec.path]
                        )
                      },
                    })}
                  />
                </div>
              </div>

              {/* STAGE 3: Kickstart & Parameters */}
              <div className="pipeline-stage-card">
                <div className="stage-card-header">
                  <div className="stage-step-badge">3</div>
                  <div className="stage-header-title">
                    <strong>安装参数与命名</strong>
                    <span>Kickstart 脚本与密码</span>
                  </div>
                </div>

                <div className="stage-card-body">
                  <div className="install-mode-toggle-group">
                    <div
                      role="button"
                      tabIndex={0}
                      className={`mode-toggle-card ${installMode === 'unattended' ? 'mode-toggle-active' : ''}`}
                      onClick={() => setInstallMode('unattended')}
                    >
                      <div className="mode-toggle-title">
                        <ThunderboltOutlined style={{ color: '#2563eb' }} />
                        <strong>无人值守自动安装 (推荐)</strong>
                      </div>
                      <span className="mode-toggle-desc">开机自动格式化首块盘装机，首次启动自动完成驱动注册。</span>
                    </div>

                    <div
                      role="button"
                      tabIndex={0}
                      className={`mode-toggle-card ${installMode === 'interactive' ? 'mode-toggle-active' : ''}`}
                      onClick={() => setInstallMode('interactive')}
                    >
                      <div className="mode-toggle-title">
                        <CheckCircleOutlined style={{ color: '#059669' }} />
                        <strong>交互式手动安装</strong>
                      </div>
                      <span className="mode-toggle-desc">保留原厂图形向导手动选盘，预载驱动照常生效。</span>
                    </div>
                  </div>

                  <Form.Item name="root_password" label="Root 默认管理密码" extra="默认值为 niuniu" style={{ marginBottom: 6 }}>
                    <Input.Password placeholder="niuniu" />
                  </Form.Item>

                  <Form.Item
                    name="custom_iso_name"
                    label={
                      <Space size={4}>
                        <span>定制 ISO 文件名</span>
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, height: 'auto', fontSize: 11 }}
                          onClick={() => form.setFieldsValue({ custom_iso_name: formulaPlaceholder })}
                        >
                          填入建议名
                        </Button>
                      </Space>
                    }
                    extra="留空自动按公式命名"
                    style={{ marginBottom: 0 }}
                  >
                    <Input className="mono" placeholder={formulaPlaceholder} allowClear />
                  </Form.Item>
                </div>
              </div>

              {/* STAGE 4: Engine Trigger */}
              <div className="pipeline-stage-card pipeline-stage-trigger-card">
                <div className="stage-card-header">
                  <div className="stage-step-badge">4</div>
                  <div className="stage-header-title">
                    <strong>执行重封装</strong>
                    <span>5~10 秒原生极速</span>
                  </div>
                </div>

                <div className="stage-card-body stage-trigger-body">
                  <div className="trigger-status-box">
                    <span className="trigger-status-chip">
                      <span className="live-dot" /> 引擎待命 · 就绪
                    </span>
                    <div className="trigger-formula-summary">
                      <div>版本：<strong>ESXi {version}</strong></div>
                      <div>驱动：<strong>{selectedDrivers.length} 个</strong></div>
                      <div>模式：<strong>{installMode === 'unattended' ? '无人值守' : '手动安装'}</strong></div>
                    </div>
                  </div>

                  <Button
                    type="primary"
                    size="large"
                    block
                    icon={<PlayCircleOutlined />}
                    loading={createMutation.isPending || isRunning}
                    onClick={runPipeline}
                    className="big-launch-button"
                  >
                    {isRunning ? '流水线执行中...' : '开始执行极速重封装'}
                  </Button>
                </div>
              </div>
            </div>
          </Form>
        </section>

        {/* ========================================================
            PART 2: LOG TERMINAL & ARTIFACT (下面页面是产出日志)
            ======================================================== */}
        <section className="pipeline-output-section" aria-label="产出日志与任务控制台">
          {/* Active Artifact Ready Banner */}
          {activeTask?.status === 'completed' && activeTask.output_iso && (
            <div className="artifact-banner-card">
              <div className="artifact-banner-main">
                <Space size={8} wrap align="center">
                  <Tag color="success" className="artifact-tag">
                    🎉 定制 ISO 构建完成
                  </Tag>
                  <Typography.Text strong className="mono" style={{ fontSize: 14 }}>
                    {activeTask.output_iso}
                  </Typography.Text>
                  {activeTask.output_iso_size ? (
                    <Tag color="blue" className="mono tabular-nums">
                      {(activeTask.output_iso_size / 1024 / 1024).toFixed(1)} MB
                    </Tag>
                  ) : null}
                  {activeTask.build_duration ? (
                    <Tag color="purple" className="mono tabular-nums">
                      总耗时 {activeTask.build_duration} 秒
                    </Tag>
                  ) : null}
                </Space>
                {activeTask.output_iso_sha256 && (
                  <div className="artifact-sha-row">
                    <span style={{ color: '#64748b' }}>SHA-256:</span>{' '}
                    <Typography.Text copyable code className="mono" style={{ fontSize: 11 }}>
                      {activeTask.output_iso_sha256}
                    </Typography.Text>
                  </div>
                )}
              </div>
              <Space size={10} wrap>
                <Button
                  type="primary"
                  size="middle"
                  icon={<DownloadOutlined />}
                  onClick={() => window.open(getBuildArtifactUrl(activeTask.task_id), '_blank', 'noopener,noreferrer')}
                >
                  立即下载定制 ISO
                </Button>
                {remoteArtifactUrl && (
                  <Button href={remoteArtifactUrl} target="_blank" rel="noreferrer" icon={<DownloadOutlined />}>
                    S3 公网直链
                  </Button>
                )}
              </Space>
            </div>
          )}

          {activeTask?.status === 'failed' && (
            <Alert
              type="error"
              showIcon
              message="流水线构建遇到错误"
              description={activeTask.error_message || '请在下方中文日志终端查看具体错误排查信息'}
              style={{ marginBottom: 12 }}
            />
          )}

          {/* Phase Timing Breakdown */}
          {activeTask && (
            <PhaseTimingBreakdown
              logs={rawLogs}
              buildDuration={activeTask.build_duration}
              isCompleted={activeTask.status === 'completed'}
            />
          )}

          {/* Chinese Log Console */}
          <div className="log-console-container">
            <div className="log-console-header">
              <Space size={10} wrap align="center">
                <span className="terminal-traffic-lights">
                  <i /><i /><i />
                </span>
                <span className="log-console-title mono">
                  {activeTaskId ? `流水线日志 · ${activeTaskId}` : '流水线输出日志'}
                </span>
                {activeTask && <BuildStatusTag status={activeTask.status} />}
                {isRunning && (
                  <span className="mono tabular-nums" style={{ color: '#38bdf8', fontSize: 12 }}>
                    进度: {displayProgress}%
                  </span>
                )}
              </Space>

              <Space size={12} wrap align="center">
                {/* Chinese / Raw Mode Switch */}
                <Segmented<LogViewMode>
                  size="small"
                  value={logViewMode}
                  onChange={setLogViewMode}
                  options={[
                    { value: 'chinese', label: '🇨🇳 中文解析项' },
                    { value: 'raw', label: '💻 原始日志' },
                  ]}
                />

                <Segmented<LogFilterType>
                  size="small"
                  value={logFilter}
                  onChange={setLogFilter}
                  options={[
                    { value: 'all', label: '全部' },
                    { value: 'issues', label: '仅错误/警告' },
                  ]}
                />

                <Space size={4}>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>滚屏跟随</span>
                  <Switch size="small" checked={autoScroll} onChange={setAutoScroll} />
                </Space>

                <Tooltip title="一键复制全部日志">
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined style={{ color: '#cbd5e1' }} />}
                    aria-label="复制全部日志"
                    onClick={() => {
                      const text =
                        logViewMode === 'chinese'
                          ? filteredChineseLogs.map((l) => l.chinese).join('\n')
                          : filteredRawLogs.join('\n')
                      navigator.clipboard.writeText(text)
                      messageApi.success('已复制全部流水线日志')
                    }}
                  />
                </Tooltip>

                <Tooltip title="刷新日志">
                  <Button
                    size="small"
                    type="text"
                    icon={<ReloadOutlined style={{ color: '#cbd5e1' }} />}
                    aria-label="刷新日志"
                    onClick={() => {
                      activeTaskQuery.refetch()
                      recentBuildsQuery.refetch()
                    }}
                  />
                </Tooltip>
              </Space>
            </div>

            {/* Terminal Body */}
            <div
              ref={logTerminalRef}
              className="log-terminal-body"
              role="log"
              aria-live="polite"
              aria-label="构建流水线日志输出"
            >
              {logViewMode === 'chinese' ? (
                filteredChineseLogs.length === 0 ? (
                  <div className="terminal-empty-text">
                    {rawLogs.length > 0 ? '当前没有异常或警告信息' : '等待流水线启动输出日志...'}
                  </div>
                ) : (
                  filteredChineseLogs.map((item, index) => (
                    <div
                      key={`cn-${index}-${item.kind}`}
                      className={`chinese-log-row log-kind-${item.kind}`}
                    >
                      <span className="log-row-badge">{item.badge}</span>
                      <span className="log-row-text">{item.chinese}</span>
                    </div>
                  ))
                )
              ) : filteredRawLogs.length === 0 ? (
                <div className="terminal-empty-text">等待输出原始日志...</div>
              ) : (
                filteredRawLogs.map((line, index) => (
                  <div key={`raw-${index}`} className="raw-log-line">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      {/* History Pipelines Drawer */}
      <Card
        style={{ marginTop: 16 }}
        size="small"
        title={
          <Space size={8}>
            <HistoryOutlined />
            <span>近期流水线构建记录</span>
            <Tag>{recentBuilds.length}</Tag>
          </Space>
        }
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => recentBuildsQuery.refetch()}
          >
            刷新历史
          </Button>
        }
      >
        <Table
          size="small"
          rowKey="task_id"
          dataSource={recentBuilds}
          loading={recentBuildsQuery.isLoading}
          pagination={{ pageSize: 5 }}
          scroll={{ x: 600 }}
          rowClassName={(r) => (r.task_id === activeTaskId ? 'ant-table-row-selected' : '')}
          onRow={(r) => ({
            style: { cursor: 'pointer' },
            onClick: () => setActiveTaskId(r.task_id),
          })}
          columns={[
            {
              title: '任务 ID / 输出镜像',
              key: 'task',
              render: (_, r) => (
                <div className="table-cell-stack">
                  <Typography.Text strong ellipsis style={{ maxWidth: 260 }}>
                    {r.custom_iso_name || `ESXi-${r.esxi_version || '8.0'}-custom.iso`}
                  </Typography.Text>
                  <Typography.Text type="secondary" className="mono" style={{ fontSize: 11 }}>
                    {r.task_id}
                  </Typography.Text>
                </div>
              ),
            },
            {
              title: '版本',
              dataIndex: 'esxi_version',
              width: 90,
              render: (v) => <Tag color="geekblue">ESXi {v}</Tag>,
            },
            {
              title: '状态',
              key: 'status',
              width: 110,
              render: (_, r) => <BuildStatusTag status={r.status} />,
            },
            {
              title: '耗时',
              dataIndex: 'build_duration',
              width: 80,
              render: (d) => (d ? `${d}s` : '-'),
            },
            {
              title: '创建时间',
              dataIndex: 'created_at',
              width: 160,
              render: (t) => formatDate(t),
            },
            {
              title: '操作',
              key: 'actions',
              width: 140,
              render: (_, r) => (
                <Space size={4} onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="载入下方终端查看中文日志">
                    <Button
                      size="small"
                      type={activeTaskId === r.task_id ? 'primary' : 'default'}
                      icon={<EyeOutlined />}
                      onClick={() => setActiveTaskId(r.task_id)}
                    />
                  </Tooltip>
                  {r.status === 'completed' && r.output_iso && (
                    <Tooltip title="下载定制 ISO">
                      <Button
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={() => window.open(getBuildArtifactUrl(r.task_id), '_blank', 'noopener,noreferrer')}
                      />
                    </Tooltip>
                  )}
                  <Popconfirm
                    title="确认删除该构建记录？"
                    onConfirm={() => deleteMutation.mutate(r.task_id)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </PageContainer>
  )
}
