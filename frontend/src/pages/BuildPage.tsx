import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  Popconfirm,
  Progress,
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
import { PageContainer, ProCard } from '../components/pro-compat'
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
} from './pageUtils'

type DepotOption = {
  key: string
  bucketId: number
  bucketName: string
  file: FileMetadata
}

type LogLevelFilter = 'all' | 'issues'
type HistoryStatusFilter = 'all' | 'running' | 'completed' | 'failed'

function depotKey(bucketId: number, file: FileMetadata) {
  return `${bucketId}:${file.id}:${file.path}`
}

function classifyLogLine(line: string): 'error' | 'warn' | 'timing' | 'progress' | 'normal' {
  const lower = line.toLowerCase()
  if (lower.includes('error') || lower.includes('failed') || lower.includes('fatal')) return 'error'
  if (lower.includes('warn')) return 'warn'
  if (line.includes('[TIMING]')) return 'timing'
  if (line.includes('[PROGRESS]')) return 'progress'
  return 'normal'
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

  // Build Recipe State
  const [version, setVersion] = useState<string>(() => searchParams.get('version') || '8.0')
  const [bucketId, setBucketId] = useState<number | undefined>(() => {
    const b = searchParams.get('bucket')
    return b ? Number(b) : undefined
  })
  const [depotPath, setDepotPath] = useState<string>(() => searchParams.get('depot') || '')
  const [driverPaths, setDriverPaths] = useState<string[]>([])
  const [installMode, setInstallMode] = useState<'unattended' | 'interactive'>('unattended')

  // Driver Filter State
  const [driverSearch, setDriverSearch] = useState('')
  const [compatibilityFilter, setCompatibilityFilter] = useState<'all' | 'match' | 'attention'>('all')

  // Optional Preflight State
  const [preflightId, setPreflightId] = useState<string | null>(null)

  // Console & History State
  const [activeTaskId, setActiveTaskId] = useState<string | null>(() => searchParams.get('task'))
  const [logFilter, setLogFilter] = useState<LogLevelFilter>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [historyFilter, setHistoryFilter] = useState<HistoryStatusFilter>('all')

  // Sync URL ?task=... changes
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

  // Query: Buckets & Depots across buckets
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

  // Auto-select first available depot when version changes or initial load
  useEffect(() => {
    if (!depotPath && depotOptions.length > 0) {
      setBucketId(depotOptions[0].bucketId)
      setDepotPath(depotOptions[0].file.path)
    }
  }, [depotOptions, depotPath])

  // Optional Preflight Query
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
      messageApi.info('已启动源文件完整性预检')
    },
    onError: (err) => messageApi.error(String(err)),
  })

  // Query: Recent Builds
  const recentBuildsQuery = useQuery({
    queryKey: ['builds-recent'],
    queryFn: () => listBuilds(1, 20),
    refetchInterval: (query) => {
      const hasRunning = (query.state.data?.items ?? []).some(
        (t) => t.status === 'running' || t.status === 'pending'
      )
      return hasRunning ? 2500 : 10000
    },
    refetchIntervalInBackground: false,
  })
  const recentBuilds = recentBuildsQuery.data?.items ?? []

  const filteredHistory = useMemo(() => {
    if (historyFilter === 'all') return recentBuilds
    if (historyFilter === 'running') {
      return recentBuilds.filter((t) => t.status === 'running' || t.status === 'pending')
    }
    return recentBuilds.filter((t) => t.status === historyFilter)
  }, [recentBuilds, historyFilter])

  // Auto-select latest task if none selected
  useEffect(() => {
    if (!activeTaskId && recentBuilds.length > 0) {
      setActiveTaskId(recentBuilds[0].task_id)
    }
  }, [activeTaskId, recentBuilds])

  // Active Task Detail & WebSocket Stream
  const activeTaskQuery = useQuery({
    queryKey: ['build-active', activeTaskId],
    queryFn: () => getBuild(activeTaskId!),
    enabled: Boolean(activeTaskId),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' || query.state.data?.status === 'pending' ? 1200 : false,
    refetchIntervalInBackground: false,
  })
  const activeTask = activeTaskQuery.data ?? recentBuilds.find((t) => t.task_id === activeTaskId)
  const activeTaskBucket = useMemo(
    () => buckets.find((b) => b.id === activeTask?.storage_bucket_id),
    [buckets, activeTask?.storage_bucket_id]
  )
  const { logs: wsLogs, progress: wsProgress } = useWebSocket(activeTaskId ?? null)

  const displayLogs = useMemo(() => {
    if (wsLogs && wsLogs.length > 0) return wsLogs
    return activeTask?.log_output ? activeTask.log_output.split('\n').filter(Boolean) : []
  }, [wsLogs, activeTask?.log_output])

  const filteredLogs = useMemo(() => {
    if (logFilter === 'all') return displayLogs
    return displayLogs.filter((line) => {
      const kind = classifyLogLine(line)
      return kind === 'error' || kind === 'warn'
    })
  }, [displayLogs, logFilter])

  const displayProgress = wsProgress || activeTask?.progress || 0

  useEffect(() => {
    if (autoScroll && logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight
    }
  }, [filteredLogs, autoScroll, activeTaskId])

  // Create Build Mutation
  const createMutation = useMutation({
    mutationFn: createBuild,
    onSuccess: (task) => {
      setActiveTaskId(task.task_id)
      setLogFilter('all')
      messageApi.success('构建任务已启动！右侧实时输出构建流')
      queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
      queryClient.invalidateQueries({ queryKey: ['overview-builds'] })
    },
    onError: (error) => messageApi.error(String(error)),
  })

  // Delete Build Mutation
  const deleteBuildMutation = useMutation({
    mutationFn: deleteBuild,
    onSuccess: (_, deletedTaskId) => {
      messageApi.success('任务记录已删除')
      if (activeTaskId === deletedTaskId) {
        setActiveTaskId(null)
      }
      queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
      queryClient.invalidateQueries({ queryKey: ['overview-builds'] })
    },
    onError: (error) => messageApi.error(String(error)),
  })

  // Driver Filtering
  const driverIsAttention = (file: FileMetadata) =>
    Boolean(file.conflicts_with || file.depends_on || file.cache_status === 'missing')

  const filteredDrivers = useMemo(() => {
    const keyword = driverSearch.trim().toLowerCase()
    return drivers.filter((file) => {
      const matchesKeyword =
        !keyword ||
        file.path.toLowerCase().includes(keyword) ||
        (file.driver_name && file.driver_name.toLowerCase().includes(keyword)) ||
        (file.driver_description && file.driver_description.toLowerCase().includes(keyword))
      const matchesCompat =
        compatibilityFilter === 'all' ||
        (compatibilityFilter === 'match' && !driverIsAttention(file)) ||
        (compatibilityFilter === 'attention' && driverIsAttention(file))
      return matchesKeyword && matchesCompat
    })
  }, [drivers, driverSearch, compatibilityFilter])

  const driverColumns: ColumnsType<FileMetadata> = [
    {
      title: '驱动包',
      key: 'name',
      render: (_, file) => (
        <div className="table-cell-stack">
          <Typography.Text strong className="driver-title">
            {file.driver_name || fileName(file)}
          </Typography.Text>
          <Typography.Text type="secondary" className="mono" ellipsis={{ tooltip: file.path }} style={{ maxWidth: 240, fontSize: 11 }}>
            {file.driver_description || file.path}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '版本',
      dataIndex: 'driver_version',
      width: 96,
      render: (val: string | undefined) => <span className="mono tabular-nums">{val || '-'}</span>,
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 82,
      render: (val: number | undefined) => <span className="mono tabular-nums">{compactSize(val)}</span>,
    },
    {
      title: '状态',
      key: 'compatibility',
      width: 86,
      render: (_, file) =>
        driverIsAttention(file) ? <Tag color="warning">需确认</Tag> : <Tag color="success">已匹配</Tag>,
    },
  ]

  const nowTimestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const formulaPlaceholder = `ESXi-${version}-custom-${nowTimestamp}.iso`

  const submitBuild = () => {
    if (!depotPath || !selectedBucketId) {
      messageApi.warning('请先选择基础镜像源文件 (ISO 或 Depot)')
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

  const allFilteredSelected =
    filteredDrivers.length > 0 && filteredDrivers.every((d) => driverPaths.includes(d.path))

  const remoteArtifactUrl =
    activeTask?.output_iso && activeTaskBucket?.public_domain
      ? buildPublicObjectUrl(activeTaskBucket.public_domain, activeTask.output_iso)
      : undefined

  return (
    <PageContainer
      title="构建工作台"
      subTitle="左侧组合基础镜像、社区驱动与安装参数，右侧原地实时追踪日志流、阶段耗时并下载定制 ISO"
    >
      {contextHolder}

      <div className="workbench-split-grid">
        {/* LEFT COLUMN: Recipe Builder */}
        <div className="workbench-recipe-col">
          <ProCard
            bordered
            headerBordered
            title={
              <Space size={8} wrap>
                <ToolOutlined style={{ color: '#2563eb' }} />
                <Typography.Text strong>新建定制构建配置</Typography.Text>
                <Tag color="green" style={{ marginInlineEnd: 0 }}>
                  Linux 原生极速引擎 (5~10 秒)
                </Tag>
              </Space>
            }
          >
            <Form
              form={form}
              layout="vertical"
              initialValues={{
                custom_iso_name: '',
                root_password: 'niuniu',
              }}
            >
              {/* Step 1: Base Version & Depot */}
              <div className="recipe-section">
                <div className="recipe-section-header">
                  <span className="step-pill">1</span>
                  <Typography.Text strong>基础版本与镜像源</Typography.Text>
                </div>

                <Form.Item label="ESXi 目标版本" style={{ marginBottom: 12 }}>
                  <Segmented
                    block
                    value={version}
                    onChange={(val) => {
                      setVersion(String(val))
                      setDepotPath('')
                      setDriverPaths([])
                      setPreflightId(null)
                    }}
                    options={esxiVersions.map((v) => ({ value: v, label: `ESXi ${v}` }))}
                  />
                </Form.Item>

                <Form.Item label="基础镜像源文件 (ISO / Depot)" required style={{ marginBottom: 8 }}>
                  <Select
                    showSearch
                    value={selectedDepot?.key}
                    placeholder="选择已上传的基础 ESXi ISO 或 Offline Depot 包"
                    loading={bucketsQuery.isLoading || depotQueries.some((q) => q.isLoading)}
                    onChange={(val) => {
                      const opt = depotOptions.find((item) => item.key === val)
                      setBucketId(opt?.bucketId)
                      setDepotPath(opt?.file.path ?? '')
                      setPreflightId(null)
                    }}
                    optionFilterProp="label"
                    notFoundContent={
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`暂无 ESXi ${version} 基础源`}>
                        <Button size="small" type="primary" icon={<CloudUploadOutlined />} onClick={() => go('/storage')}>
                          去存储库上传
                        </Button>
                      </Empty>
                    }
                    options={depotOptions.map((item) => ({
                      value: item.key,
                      label: `${item.bucketName} / ${fileName(item.file)}`,
                    }))}
                  />
                </Form.Item>

                {selectedDepot && (
                  <div className="selected-source-strip">
                    <Space size={6} wrap style={{ flex: 1, minWidth: 0 }}>
                      <Tag color="blue" style={{ marginInlineEnd: 0 }}>{selectedDepot.bucketName}</Tag>
                      <Tag color={cacheStatusColor(selectedDepot.file, selectedBucket)} style={{ marginInlineEnd: 0 }}>
                        {cacheStatusText(selectedDepot.file, selectedBucket)}
                      </Tag>
                      {selectedDepot.file.size ? (
                        <Tag style={{ marginInlineEnd: 0 }}>{compactSize(selectedDepot.file.size)}</Tag>
                      ) : null}
                      <Typography.Text code className="mono" ellipsis={{ tooltip: selectedDepot.file.path }} style={{ fontSize: 11 }}>
                        {selectedDepot.file.path}
                      </Typography.Text>
                    </Space>
                    <Tooltip title="预校验源文件与所选驱动在存储中的完整性">
                        <Button
                          size="small"
                          type="text"
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
                          预检
                        </Button>
                      </Tooltip>
                  </div>
                )}

                {preflightQuery.data && (
                  <Alert
                    style={{ marginTop: 8 }}
                    type={
                      preflightQuery.data.status === 'ready'
                        ? 'success'
                        : preflightQuery.data.status === 'running'
                          ? 'info'
                          : 'warning'
                    }
                    showIcon
                    message={
                      preflightQuery.data.status === 'ready'
                        ? `源文件预检通过 (${preflightQuery.data.files?.length ?? 1} 项就绪)`
                        : preflightQuery.data.message || `预检状态：${preflightQuery.data.status}`
                    }
                  />
                )}
              </div>

              {/* Step 2: Driver Injection */}
              <div className="recipe-section">
                <div className="recipe-section-header">
                  <Space size={8}>
                    <span className="step-pill">2</span>
                    <Typography.Text strong>
                      注入驱动包 ({selectedDrivers.length}/{drivers.length} 已选)
                    </Typography.Text>
                  </Space>
                  <Space size={6} wrap>
                    <Segmented<'all' | 'match' | 'attention'>
                      size="small"
                      value={compatibilityFilter}
                      onChange={setCompatibilityFilter}
                      options={[
                        { value: 'all', label: '全部' },
                        { value: 'match', label: '已匹配' },
                        { value: 'attention', label: '需确认' },
                      ]}
                    />
                    <Button
                      size="small"
                      onClick={() => {
                        const currentPaths = filteredDrivers.map((d) => d.path)
                        if (allFilteredSelected) {
                          setDriverPaths(driverPaths.filter((p) => !currentPaths.includes(p)))
                        } else {
                          setDriverPaths(Array.from(new Set([...driverPaths, ...currentPaths])))
                        }
                      }}
                    >
                      {allFilteredSelected ? '取消全选' : '全选当前'}
                    </Button>
                    {driverPaths.length > 0 && (
                      <Button size="small" type="text" danger onClick={() => setDriverPaths([])}>
                        清空
                      </Button>
                    )}
                  </Space>
                </div>

                <Input
                  allowClear
                  size="small"
                  prefix={<SearchOutlined />}
                  placeholder="搜索驱动"
                  style={{ marginBottom: 8 }}
                  value={driverSearch}
                  onChange={(e) => setDriverSearch(e.target.value)}
                />

                {selectedDrivers.length > 0 && (
                  <div className="selected-driver-pills">
                    {selectedDrivers.map((drv) => (
                      <Tag
                        key={drv.path}
                        color="blue"
                        closable
                        onClose={() => setDriverPaths(driverPaths.filter((p) => p !== drv.path))}
                      >
                        {drv.driver_name || fileName(drv)}
                      </Tag>
                    ))}
                  </div>
                )}

                <Table
                  size="small"
                  rowKey="path"
                  bordered
                  pagination={false}
                  scroll={{ y: 205 }}
                  loading={driversQuery.isLoading}
                  dataSource={filteredDrivers}
                  columns={driverColumns}
                  className="build-driver-table"
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前版本下暂无可选驱动（可不选直接构建）" /> }}
                  rowSelection={{
                    selectedRowKeys: driverPaths,
                    onChange: (keys) => setDriverPaths(keys as string[]),
                  }}
                  onRow={(record) => ({
                    style: { cursor: 'pointer' },
                    onClick: () => {
                      setDriverPaths((prev) =>
                        prev.includes(record.path)
                          ? prev.filter((p) => p !== record.path)
                          : [...prev, record.path]
                      )
                    },
                  })}
                />
              </div>

              {/* Step 3: Core Install Parameters & Naming */}
              <div className="recipe-section" style={{ borderBottom: 'none', paddingBottom: 4 }}>
                <div className="recipe-section-header">
                  <Space size={8}>
                    <span className="step-pill">3</span>
                    <SettingOutlined style={{ color: '#2563eb' }} />
                    <Typography.Text strong>核心安装参数调整与镜像命名</Typography.Text>
                  </Space>
                </div>

                <div className="install-mode-grid" role="radiogroup" aria-label="安装模式选择">
                  <div
                    role="radio"
                    tabIndex={0}
                    aria-checked={installMode === 'unattended'}
                    className={`install-mode-card ${installMode === 'unattended' ? 'install-mode-card-active' : ''}`}
                    onClick={() => setInstallMode('unattended')}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setInstallMode('unattended')}
                  >
                    <div className="install-mode-title">
                      <ThunderboltOutlined style={{ color: '#2563eb' }} />
                      <span>无人值守自动安装</span>
                      <Tag color="blue" style={{ marginInlineEnd: 0, fontSize: 11 }}>推荐</Tag>
                    </div>
                    <div className="install-mode-desc">
                      开机自动格式化首块本地磁盘完成部署，首次进系统自动完成社区驱动注册。
                    </div>
                  </div>

                  <div
                    role="radio"
                    tabIndex={0}
                    aria-checked={installMode === 'interactive'}
                    className={`install-mode-card ${installMode === 'interactive' ? 'install-mode-card-active' : ''}`}
                    onClick={() => setInstallMode('interactive')}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setInstallMode('interactive')}
                  >
                    <div className="install-mode-title">
                      <CheckCircleOutlined style={{ color: '#059669' }} />
                      <span>交互式手动安装</span>
                    </div>
                    <div className="install-mode-desc">
                      保留官方原厂图形安装向导，手动挑选目标硬盘，预载驱动照常生效。
                    </div>
                  </div>
                </div>

                <div className="param-two-col">
                  <Form.Item
                    name="root_password"
                    label="Root 初始管理密码"
                    extra="默认值为 niuniu"
                    style={{ marginBottom: 10 }}
                  >
                    <Input.Password placeholder="niuniu" />
                  </Form.Item>

                  <Form.Item
                    name="custom_iso_name"
                    label={
                      <Space size={6}>
                        <span>输出镜像名称</span>
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, height: 'auto', fontSize: 12 }}
                          onClick={() => form.setFieldsValue({ custom_iso_name: formulaPlaceholder })}
                        >
                          填入建议名
                        </Button>
                      </Space>
                    }
                    extra="留空按公式自动生成时间戳文件名"
                    style={{ marginBottom: 10 }}
                  >
                    <Input className="mono" placeholder={formulaPlaceholder} allowClear />
                  </Form.Item>
                </div>
              </div>

              {/* Sticky Submit Footer */}
              <div className="recipe-launch-bar">
                <div className="recipe-launch-summary">
                  <Typography.Text strong>ESXi {version}</Typography.Text>
                  <span className="summary-dot">·</span>
                  <Typography.Text type="secondary">
                    已选 <strong className="tabular-nums">{selectedDrivers.length}</strong> 个驱动
                  </Typography.Text>
                  <span className="summary-dot">·</span>
                  <Typography.Text type="secondary">
                    {installMode === 'unattended' ? '无人值守' : '交互式安装'}
                  </Typography.Text>
                </div>
                <Button
                  type="primary"
                  size="large"
                  icon={<PlayCircleOutlined />}
                  onClick={submitBuild}
                  loading={createMutation.isPending}
                >
                  开始极速构建
                </Button>
              </div>
            </Form>
          </ProCard>
        </div>

        {/* RIGHT COLUMN: Live Task Console & History Dock */}
        <div className="workbench-console-col">
          {/* Card 1: Active Task Console */}
          <ProCard
            bordered
            headerBordered
            title={
              <Space wrap size={8}>
                <ClockCircleOutlined style={{ color: '#2563eb' }} />
                <Typography.Text strong>构建任务控制台与实时日志</Typography.Text>
                {activeTask && <BuildStatusTag status={activeTask.status} />}
              </Space>
            }
            extra={
              <Space size={6} wrap>
                {activeTask?.status === 'completed' && activeTask.output_iso && (
                  <Button
                    type="primary"
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => window.open(getBuildArtifactUrl(activeTask.task_id), '_blank', 'noopener,noreferrer')}
                  >
                    下载定制 ISO
                  </Button>
                )}
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    activeTaskQuery.refetch()
                    recentBuildsQuery.refetch()
                  }}
                >
                  刷新
                </Button>
              </Space>
            }
          >
            {activeTask ? (
              <div className="console-stack">
                <div className="task-meta-grid">
                  <div className="task-meta-cell">
                    <span className="task-meta-label">任务 ID</span>
                    <Typography.Text className="mono" copyable ellipsis style={{ fontSize: 12 }}>
                      {activeTask.task_id}
                    </Typography.Text>
                  </div>
                  <div className="task-meta-cell">
                    <span className="task-meta-label">版本 / 驱动</span>
                    <span className="tabular-nums" style={{ fontWeight: 600 }}>
                      ESXi {activeTask.esxi_version} · {parseDrivers(activeTask.drivers).length} 驱动
                    </span>
                  </div>
                  <div className="task-meta-cell">
                    <span className="task-meta-label">构建耗时</span>
                    <span className="mono tabular-nums" style={{ fontWeight: 600 }}>
                      {activeTask.build_duration ? `${activeTask.build_duration} 秒` : '进行中'}
                    </span>
                  </div>
                  <div className="task-meta-cell">
                    <span className="task-meta-label">实时进度</span>
                    <span className="mono tabular-nums" style={{ fontWeight: 700, color: '#2563eb' }}>
                      {displayProgress}%
                    </span>
                  </div>
                </div>

                <Progress
                  percent={displayProgress}
                  status={
                    activeTask.status === 'failed'
                      ? 'exception'
                      : activeTask.status === 'completed'
                        ? 'success'
                        : 'active'
                  }
                  strokeColor={{ '0%': '#2563eb', '100%': '#10b981' }}
                />

                {activeTask.status === 'completed' && activeTask.output_iso && (
                  <div className="artifact-ready-box">
                    <div className="artifact-ready-main">
                      <Space size={8} wrap>
                        <Tag color="success" style={{ marginInlineEnd: 0 }}>产物已就绪</Tag>
                        <Typography.Text strong className="mono" ellipsis={{ tooltip: activeTask.output_iso }}>
                          {activeTask.output_iso}
                        </Typography.Text>
                        {activeTask.output_iso_size ? (
                          <Tag color="blue" className="tabular-nums" style={{ marginInlineEnd: 0 }}>
                            {(activeTask.output_iso_size / 1024 / 1024).toFixed(1)} MB
                          </Tag>
                        ) : null}
                      </Space>
                      {activeTask.output_iso_sha256 && (
                        <Typography.Text type="secondary" className="mono" copyable style={{ fontSize: 11 }}>
                          SHA-256: {activeTask.output_iso_sha256}
                        </Typography.Text>
                      )}
                    </div>
                    <Space size={8} wrap>
                      <Button
                        type="primary"
                        icon={<DownloadOutlined />}
                        onClick={() => window.open(getBuildArtifactUrl(activeTask.task_id), '_blank', 'noopener,noreferrer')}
                      >
                        立即下载 ISO
                      </Button>
                      {remoteArtifactUrl && (
                        <Button href={remoteArtifactUrl} target="_blank" rel="noreferrer">
                          公网直链
                        </Button>
                      )}
                    </Space>
                  </div>
                )}

                {activeTask.status === 'failed' && (
                  <Alert
                    type="error"
                    showIcon
                    message="构建执行失败"
                    description={activeTask.error_message || '请查看下方终端日志排查具体错误原因'}
                  />
                )}

                <PhaseTimingBreakdown
                  logs={displayLogs}
                  buildDuration={activeTask.build_duration}
                  isCompleted={activeTask.status === 'completed'}
                />

                <div className="terminal-box">
                  <div className="terminal-toolbar">
                    <Space size={8}>
                      <span className="terminal-dots" aria-hidden="true">
                        <i /><i /><i />
                      </span>
                      <span className="terminal-title mono">
                        build-output.log ({filteredLogs.length} 行)
                      </span>
                    </Space>
                    <Space size={10} wrap>
                      <Segmented<LogLevelFilter>
                        size="small"
                        value={logFilter}
                        onChange={setLogFilter}
                        options={[
                          { value: 'all', label: '全部' },
                          { value: 'issues', label: '仅警告/错误' },
                        ]}
                      />
                      <Space size={4}>
                        <span style={{ color: '#94a3b8', fontSize: 11 }}>跟随底部</span>
                        <Switch size="small" checked={autoScroll} onChange={setAutoScroll} />
                      </Space>
                      <Tooltip title="复制全部日志">
                        <Button
                          size="small"
                          type="text"
                          icon={<CopyOutlined style={{ color: '#cbd5e1' }} />}
                          aria-label="复制全部日志"
                          onClick={() => {
                            navigator.clipboard.writeText(displayLogs.join('\n'))
                            messageApi.success('已复制构建日志')
                          }}
                        />
                      </Tooltip>
                    </Space>
                  </div>

                  <div
                    ref={logTerminalRef}
                    className="log-console"
                    role="log"
                    aria-live="polite"
                    aria-label="实时构建输出日志"
                  >
                    {filteredLogs.length === 0 ? (
                      <div style={{ color: '#64748b', padding: '18px 0', textAlign: 'center' }}>
                        {displayLogs.length > 0 ? '当前没有警告或错误日志' : '等待日志流输出...'}
                      </div>
                    ) : (
                      filteredLogs.map((line, index) => (
                        <div key={`${index}-${line.slice(0, 24)}`} className={`log-line log-line-${classifyLogLine(line)}`}>
                          {line}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="左侧选好配置后点击「开始极速构建」，或在下方点击任意历史任务查看详情"
              />
            )}
          </ProCard>

          {/* Card 2: Recent Builds Interactive Switcher */}
          <ProCard
            bordered
            headerBordered
            className="contain-panel"
            title={
              <Space size={8}>
                <ClockCircleOutlined />
                <Typography.Text strong>近期构建任务</Typography.Text>
                <Tag style={{ marginInlineEnd: 0 }}>{recentBuilds.length}</Tag>
              </Space>
            }
            extra={
              <Space size={6} wrap>
                <Segmented<HistoryStatusFilter>
                  size="small"
                  value={historyFilter}
                  onChange={setHistoryFilter}
                  options={[
                    { value: 'all', label: '全部' },
                    { value: 'running', label: '运行中' },
                    { value: 'completed', label: '已完成' },
                    { value: 'failed', label: '失败' },
                  ]}
                />
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['builds-recent'] })}
                >
                  刷新列表
                </Button>
              </Space>
            }
          >
            <Table
              size="small"
              rowKey="task_id"
              loading={recentBuildsQuery.isLoading}
              dataSource={filteredHistory}
              pagination={{ pageSize: 5, showSizeChanger: false }}
              scroll={{ x: 560 }}
              rowClassName={(r) => (r.task_id === activeTaskId ? 'ant-table-row-selected' : '')}
              onRow={(r) => ({
                style: { cursor: 'pointer' },
                onClick: () => setActiveTaskId(r.task_id),
              })}
              columns={[
                {
                  title: '镜像名称 / ID',
                  key: 'name',
                  render: (_, r: BuildTask) => (
                    <div className="table-cell-stack">
                      <Typography.Text strong ellipsis style={{ maxWidth: 210 }}>
                        {r.custom_iso_name || `ESXi-${r.esxi_version || '8.0'}-custom.iso`}
                      </Typography.Text>
                      <Typography.Text type="secondary" className="mono" style={{ fontSize: 11 }}>
                        {r.task_id}
                      </Typography.Text>
                    </div>
                  ),
                },
                {
                  title: '状态',
                  key: 'status',
                  width: 100,
                  render: (_, r: BuildTask) => <BuildStatusTag status={r.status} />,
                },
                {
                  title: '耗时',
                  dataIndex: 'build_duration',
                  width: 72,
                  render: (d: number | undefined) => (
                    <span className="mono tabular-nums">{d ? `${d}s` : '-'}</span>
                  ),
                },
                {
                  title: '创建时间',
                  dataIndex: 'created_at',
                  width: 152,
                  render: (t: string) => (
                    <span className="tabular-nums" style={{ fontSize: 12, color: '#64748b' }}>
                      {formatDate(t)}
                    </span>
                  ),
                },
                {
                  title: '操作',
                  key: 'actions',
                  width: 136,
                  render: (_, r: BuildTask) => (
                    <Space size={4} onClick={(e) => e.stopPropagation()}>
                      <Tooltip title="在上方控制台查看">
                        <Button
                          size="small"
                          type={activeTaskId === r.task_id ? 'primary' : 'default'}
                          icon={<EyeOutlined />}
                          aria-label={`查看任务 ${r.task_id}`}
                          onClick={() => setActiveTaskId(r.task_id)}
                        />
                      </Tooltip>
                      {r.status === 'completed' && r.output_iso && (
                        <Tooltip title="下载定制 ISO">
                          <Button
                            size="small"
                            icon={<DownloadOutlined />}
                            aria-label={`下载任务 ${r.task_id} ISO`}
                            onClick={() => window.open(getBuildArtifactUrl(r.task_id), '_blank', 'noopener,noreferrer')}
                          />
                        </Tooltip>
                      )}
                      <Popconfirm
                        title="确认删除此构建记录与产物？"
                        onConfirm={() => deleteBuildMutation.mutate(r.task_id)}
                        okText="删除"
                        cancelText="取消"
                      >
                        <Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除任务 ${r.task_id}`} />
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
          </ProCard>
        </div>
      </div>
    </PageContainer>
  )
}
