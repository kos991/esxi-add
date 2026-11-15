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
  ThunderboltOutlined,
} from '../components/icons'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Drawer,
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
import { PageContainer } from '../components/pro-compat'
import { useWebSocket } from '../hooks/useWebSocket'
import type { BuildTask, FileMetadata } from '../types'
import { buildPublicObjectUrl, formatDate, parseDrivers } from '../utils'
import {
  BuildStatusTag,
  cacheStatusColor,
  cacheStatusText,
  compactSize,
  copyText,
  dedupeChineseLogs,
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
    if (routerNavigate) routerNavigate(path)
    else window.location.assign(path)
  }

  // 配方状态
  const [version, setVersion] = useState<string>(() => searchParams.get('version') || '8.0')
  const [bucketId, setBucketId] = useState<number | undefined>(() => {
    const b = searchParams.get('bucket')
    return b ? Number(b) : undefined
  })
  const [depotPath, setDepotPath] = useState<string>(() => searchParams.get('depot') || '')
  const [driverPaths, setDriverPaths] = useState<string[]>([])
  const [installMode, setInstallMode] = useState<'unattended' | 'interactive'>('unattended')
  const [driverSearch, setDriverSearch] = useState('')

  // 预检
  const [preflightId, setPreflightId] = useState<string | null>(null)
  const [preflightInputKey, setPreflightInputKey] = useState('')

  // 任务查看状态：本次提交的任务与历史查看必须分开
  const [activeTaskId, setActiveTaskId] = useState<string | null>(() => searchParams.get('task'))
  const [submittedTaskId, setSubmittedTaskId] = useState<string | null>(null)
  const [logViewMode, setLogViewMode] = useState<LogViewMode>('chinese')
  const [logFilter, setLogFilter] = useState<LogFilterType>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false)

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

  // 存储与镜像源
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

  const driversQuery = useQuery({
    queryKey: ['build-drivers', selectedBucketId, version],
    queryFn: () => listDrivers(selectedBucketId as number, version),
    enabled: Boolean(selectedBucketId),
  })
  const drivers = driversQuery.data ?? []
  const selectedDepot = depotOptions.find(
    (item) => item.bucketId === selectedBucketId && item.file.path === depotPath
  )

  // 只保留当前仓库/版本真实存在的驱动，避免提交屏幕上看不到的旧路径
  const effectiveDriverPaths = useMemo(
    () => driverPaths.filter((p) => drivers.some((d) => d.path === p)),
    [driverPaths, drivers]
  )
  const selectedDrivers = useMemo(
    () => drivers.filter((file) => effectiveDriverPaths.includes(file.path)),
    [drivers, effectiveDriverPaths]
  )

  useEffect(() => {
    if (!depotPath && depotOptions.length > 0) {
      setBucketId(depotOptions[0].bucketId)
      setDepotPath(depotOptions[0].file.path)
    }
  }, [depotOptions, depotPath])

  // 预检：结果绑定到输入快照，输入一变就过期
  const currentInputKey = `${selectedBucketId}|${depotPath}|${version}|${effectiveDriverPaths.join(',')}`
  const preflightQuery = useQuery({
    queryKey: ['build-preflight', preflightId],
    queryFn: () => getBuildPreflight(preflightId!),
    enabled: Boolean(preflightId),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1200 : false),
    refetchIntervalInBackground: false,
  })
  const preflightFresh = Boolean(preflightId) && preflightInputKey === currentInputKey

  const preflightMutation = useMutation({
    mutationFn: startBuildPreflight,
    onSuccess: (res) => {
      setPreflightId(res.id)
      setPreflightInputKey(currentInputKey)
    },
    onError: (err) => messageApi.error(String(err)),
  })

  // 最近任务（仅用于历史，不自动充当本次结果）
  const recentBuildsQuery = useQuery({
    queryKey: ['builds-recent'],
    queryFn: () => listBuilds(1, 30),
    refetchInterval: (query) => {
      const hasRunning = (query.state.data?.items ?? []).some(
        (t) => t.status === 'running' || t.status === 'pending'
      )
      return hasRunning ? 2500 : 12000
    },
    refetchIntervalInBackground: false,
  })
  const recentBuilds = recentBuildsQuery.data?.items ?? []

  const activeTaskQuery = useQuery({
    queryKey: ['build-active', activeTaskId],
    queryFn: () => getBuild(activeTaskId!),
    enabled: Boolean(activeTaskId),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' || query.state.data?.status === 'pending' ? 1500 : false,
    refetchIntervalInBackground: false,
  })
  const activeTask = activeTaskQuery.data ?? recentBuilds.find((t) => t.task_id === activeTaskId)
  const activeTaskBucket = useMemo(
    () => buckets.find((b) => b.id === activeTask?.storage_bucket_id),
    [buckets, activeTask?.storage_bucket_id]
  )
  const { logs: wsLogs, progress: wsProgress, state: wsState } = useWebSocket(activeTaskId ?? null)

  const isTaskRunning = activeTask?.status === 'running' || activeTask?.status === 'pending'

  // 只在任务仍在运行时采用 WebSocket 进度，避免旧进度覆盖已完成状态
  const displayProgress = isTaskRunning
    ? Math.max(wsProgress || 0, activeTask?.progress || 0)
    : activeTask?.progress ?? 0

  const rawLogs = useMemo(() => {
    const fromTask = activeTask?.log_output ? activeTask.log_output.split('\n').filter(Boolean) : []
    // WebSocket 有内容时优先，但历史任务用接口返回的完整日志
    if (wsLogs.length > 0 && activeTaskId === submittedTaskId) return wsLogs
    return fromTask
  }, [wsLogs, activeTask?.log_output, activeTaskId, submittedTaskId])

  const chineseLogs = useMemo(() => dedupeChineseLogs(rawLogs.map(formatLogToChinese)), [rawLogs])

  const filteredChineseLogs = useMemo(
    () => (logFilter === 'all' ? chineseLogs : chineseLogs.filter((i) => i.kind === 'error' || i.kind === 'warn')),
    [chineseLogs, logFilter]
  )
  const filteredRawLogs = useMemo(() => {
    if (logFilter === 'all') return rawLogs
    return rawLogs.filter((l) => /error|failed|failure|fatal|warn/i.test(l))
  }, [rawLogs, logFilter])

  useEffect(() => {
    if (autoScroll && logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight
    }
  }, [filteredChineseLogs, filteredRawLogs, autoScroll, activeTaskId])

  const createMutation = useMutation({
    mutationFn: createBuild,
    onSuccess: (task) => {
      setActiveTaskId(task.task_id)
      setSubmittedTaskId(task.task_id)
      setLogFilter('all')
      messageApi.success('流水线已启动，下方显示本次构建日志')
      queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
      window.setTimeout(
        () => document.getElementById('pipeline-output')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }),
        150
      )
    },
    onError: (err) => messageApi.error(`创建任务失败：${String(err)}`),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteBuild,
    onSuccess: (_, deletedId) => {
      messageApi.success('任务记录已删除')
      if (activeTaskId === deletedId) {
        setActiveTaskId(null)
        setSubmittedTaskId(null)
      }
      queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
    },
    onError: (err) => messageApi.error(`删除失败：${String(err)}`),
  })

  const filteredDrivers = useMemo(() => {
    const kw = driverSearch.trim().toLowerCase()
    if (!kw) return drivers
    return drivers.filter(
      (d) =>
        d.path.toLowerCase().includes(kw) ||
        (d.driver_name && d.driver_name.toLowerCase().includes(kw)) ||
        (d.driver_description && d.driver_description.toLowerCase().includes(kw))
    )
  }, [drivers, driverSearch])

  const allDriversSelected =
    filteredDrivers.length > 0 && filteredDrivers.every((d) => effectiveDriverPaths.includes(d.path))

  const driverColumns: ColumnsType<FileMetadata> = [
    {
      title: '驱动包',
      key: 'name',
      render: (_, file) => (
        <div className="table-cell-stack">
          <Typography.Text strong ellipsis style={{ maxWidth: 260 }}>
            {file.driver_name || fileName(file)}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            className="mono"
            ellipsis={{ tooltip: file.path }}
            style={{ fontSize: 11 }}
          >
            {file.driver_description || file.path}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '版本',
      dataIndex: 'driver_version',
      width: 84,
      render: (v) => <span className="mono tabular-nums">{v || '-'}</span>,
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 78,
      render: (v) => <span className="mono tabular-nums">{compactSize(v)}</span>,
    },
    {
      title: '标记',
      key: 'flag',
      width: 84,
      render: (_, file) =>
        file.conflicts_with || file.depends_on || file.cache_status === 'missing' ? (
          <Tooltip title="存在冲突、依赖或缓存缺失标记，请自行确认兼容性">
            <Tag color="warning">待确认</Tag>
          </Tooltip>
        ) : (
          <Tooltip title="未发现冲突或依赖标记，不代表已验证硬件兼容性">
            <Tag>无标记</Tag>
          </Tooltip>
        ),
    },
  ]

  const nowTimestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const formulaPlaceholder = `ESXi-${version}-custom-${nowTimestamp}.iso`

  const runPipeline = () => {
    if (!depotPath || !selectedBucketId) {
      messageApi.warning('请先在第 1 步选择基础镜像源（ISO 或 Depot）')
      return
    }
    form.validateFields().then((values) => {
      createMutation.mutate({
        bucket_id: selectedBucketId,
        esxi_version: version,
        depot_path: depotPath,
        driver_paths: effectiveDriverPaths,
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

  const viewingHistory = Boolean(activeTaskId) && activeTaskId !== submittedTaskId

  const copyLogs = async () => {
    const text =
      logViewMode === 'chinese'
        ? filteredChineseLogs.map((l) => l.chinese).join('\n')
        : filteredRawLogs.join('\n')
    const ok = await copyText(text)
    if (ok) messageApi.success('已复制日志')
    else messageApi.error('当前浏览器不允许访问剪贴板，请手动选择文本复制')
  }

  return (
    <PageContainer
      title="构建流水线"
      subTitle="上方编排基础镜像、驱动与安装参数，下方查看本次构建的实时日志与产物"
      extra={[
        <Button key="history" icon={<HistoryOutlined />} onClick={() => setHistoryDrawerOpen(true)}>
          历史流水线（{recentBuilds.length}）
        </Button>,
        <Button key="storage" icon={<CloudUploadOutlined />} onClick={() => go('/storage')}>
          存储与挂载
        </Button>,
      ]}
    >
      {contextHolder}

      <div className="pipeline-page-flow">
        <section className="pipeline-composer-section" aria-label="流水线配置">
          <div className="pipeline-section-bar">
            <Space size={8} wrap align="center">
              <Typography.Text strong style={{ fontSize: 15 }}>
                构建配置
              </Typography.Text>
              <Tag color="geekblue" className="engine-chip">
                <ThunderboltOutlined /> 原生重封装 / PowerCLI 备用
              </Tag>
              {selectedDepot?.bucketType === 's3' && (
                <Tag color="cyan">S3 挂载：{selectedDepot.bucketName}</Tag>
              )}
            </Space>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={createMutation.isPending}
              onClick={runPipeline}
              className="pipeline-run-main-btn"
            >
              运行构建流水线
            </Button>
          </div>

          <Form form={form} layout="vertical" initialValues={{ custom_iso_name: '', root_password: 'niuniu' }}>
            <div className="pipeline-config-grid">
              {/* 1 基础镜像源 */}
              <div className="pipeline-stage-card">
                <div className="stage-card-header">
                  <div className="stage-step-badge">1</div>
                  <div className="stage-header-title">
                    <strong>基础镜像源</strong>
                    <span>原版 ISO / Depot</span>
                  </div>
                </div>
                <div className="stage-card-body">
                  <Form.Item label="ESXi 版本" style={{ marginBottom: 8 }}>
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
                      options={esxiVersions.map((v) => ({ value: v, label: v }))}
                    />
                  </Form.Item>

                  <Form.Item label="基础镜像文件" required style={{ marginBottom: 6 }}>
                    <Select
                      showSearch
                      value={selectedDepot?.key}
                      placeholder="选择已上传的 ISO 或 Depot"
                      loading={bucketsQuery.isLoading || depotQueries.some((q) => q.isLoading)}
                      onChange={(val) => {
                        const opt = depotOptions.find((o) => o.key === val)
                        setBucketId(opt?.bucketId)
                        setDepotPath(opt?.file.path ?? '')
                        // 换源换盘必须清掉旧驱动选择，避免提交不可见路径
                        setDriverPaths([])
                        setPreflightId(null)
                      }}
                      optionFilterProp="label"
                      notFoundContent={
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`暂无 ESXi ${version} 基础源`}>
                          <Button size="small" type="primary" onClick={() => go('/storage')}>
                            去存储上传
                          </Button>
                        </Empty>
                      }
                      options={depotOptions.map((item) => ({
                        value: item.key,
                        label: `[${item.bucketName}] ${fileName(item.file)}`,
                      }))}
                    />
                  </Form.Item>

                  {selectedDepot ? (
                    <div className="stage-source-summary">
                      <Space size={6} wrap>
                        <Tag color={selectedDepot.bucketType === 's3' ? 'cyan' : 'blue'}>
                          {selectedDepot.bucketType === 's3' ? 'S3' : '本地'} · {selectedDepot.bucketName}
                        </Tag>
                        <Tag color={cacheStatusColor(selectedDepot.file, selectedBucket)}>
                          {cacheStatusText(selectedDepot.file, selectedBucket)}
                        </Tag>
                        {selectedDepot.file.size ? (
                          <span className="mono tabular-nums" style={{ fontSize: 11, color: '#475569' }}>
                            {compactSize(selectedDepot.file.size)}
                          </span>
                        ) : null}
                      </Space>
                      <Typography.Text
                        code
                        className="mono"
                        ellipsis={{ tooltip: selectedDepot.file.path }}
                        style={{ fontSize: 11, display: 'block', marginTop: 4 }}
                      >
                        {selectedDepot.file.path}
                      </Typography.Text>
                      <div className="preflight-row">
                        <Button
                          size="small"
                          icon={<SafetyCertificateOutlined />}
                          loading={preflightMutation.isPending}
                          disabled={!preflightInputKey && !selectedDepot}
                          onClick={() => {
                            if (!selectedBucketId || !depotPath) return
                            preflightMutation.mutate({
                              bucket_id: selectedBucketId,
                              depot_path: depotPath,
                              driver_paths: effectiveDriverPaths,
                            })
                          }}
                        >
                          预检源文件
                        </Button>
                        {!preflightFresh && preflightId && (
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            参数已变更，需重新预检
                          </Typography.Text>
                        )}
                      </div>
                      {preflightFresh && preflightQuery.data && (
                        <Alert
                          style={{ marginTop: 6 }}
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
                              ? '源文件预检通过'
                              : preflightQuery.data.status === 'running'
                                ? '正在预检…'
                                : `预检未通过：${preflightQuery.data.message || preflightQuery.data.status}`
                          }
                        />
                      )}
                      {preflightFresh && preflightQuery.isError && (
                        <Alert
                          style={{ marginTop: 6 }}
                          type="error"
                          showIcon
                          message={`预检查询失败：${String(preflightQuery.error)}`}
                        />
                      )}
                    </div>
                  ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      尚未选择基础镜像，构建无法开始。
                    </Typography.Text>
                  )}
                </div>
              </div>

              {/* 2 驱动注入 */}
              <div className="pipeline-stage-card">
                <div className="stage-card-header">
                  <div className="stage-step-badge">2</div>
                  <div className="stage-header-title">
                    <strong>驱动注入</strong>
                    <span>可选，默认不注入</span>
                  </div>
                  <Tag style={{ marginInlineEnd: 0 }}>已选 {selectedDrivers.length}</Tag>
                </div>
                <div className="stage-card-body">
                  <div className="driver-toolbar-mini">
                    <Input
                      size="small"
                      allowClear
                      prefix={<SearchOutlined />}
                      placeholder="搜索驱动包"
                      value={driverSearch}
                      onChange={(e) => setDriverSearch(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <Button
                      size="small"
                      onClick={() => {
                        const paths = filteredDrivers.map((d) => d.path)
                        if (allDriversSelected) {
                          setDriverPaths(effectiveDriverPaths.filter((p) => !paths.includes(p)))
                        } else {
                          setDriverPaths(Array.from(new Set([...effectiveDriverPaths, ...paths])))
                        }
                      }}
                    >
                      {allDriversSelected ? '取消' : '全选'}
                    </Button>
                    {effectiveDriverPaths.length > 0 && (
                      <Button size="small" type="text" danger onClick={() => setDriverPaths([])}>
                        清空
                      </Button>
                    )}
                  </div>

                  {selectedDrivers.length > 0 && (
                    <div className="selected-drivers-box">
                      {selectedDrivers.map((d) => (
                        <Tag
                          key={d.path}
                          color="blue"
                          closable
                          onClose={() => setDriverPaths(effectiveDriverPaths.filter((p) => p !== d.path))}
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
                    scroll={{ y: 132 }}
                    loading={driversQuery.isLoading}
                    dataSource={filteredDrivers}
                    columns={driverColumns}
                    className="compact-driver-table"
                    locale={{
                      emptyText: (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={driversQuery.isError ? '驱动加载失败' : '当前版本暂无可选驱动'}
                        />
                      ),
                    }}
                    rowSelection={{
                      selectedRowKeys: effectiveDriverPaths,
                      onChange: (keys) => setDriverPaths(keys as string[]),
                    }}
                  />
                </div>
              </div>

              {/* 3 安装参数 */}
              <div className="pipeline-stage-card">
                <div className="stage-card-header">
                  <div className="stage-step-badge">3</div>
                  <div className="stage-header-title">
                    <strong>安装参数</strong>
                    <span>Kickstart 与命名</span>
                  </div>
                </div>
                <div className="stage-card-body">
                  <div className="install-mode-toggle-group">
                    <div
                      role="radio"
                      aria-checked={installMode === 'unattended'}
                      tabIndex={0}
                      className={`mode-toggle-card ${installMode === 'unattended' ? 'mode-toggle-active' : ''}`}
                      onClick={() => setInstallMode('unattended')}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setInstallMode('unattended')}
                    >
                      <div className="mode-toggle-title">
                        <ThunderboltOutlined style={{ color: '#2563eb' }} />
                        <strong>无人值守</strong>
                      </div>
                      <span className="mode-toggle-desc">开机自动格式化首块磁盘并完成安装。</span>
                    </div>
                    <div
                      role="radio"
                      aria-checked={installMode === 'interactive'}
                      tabIndex={0}
                      className={`mode-toggle-card ${installMode === 'interactive' ? 'mode-toggle-active' : ''}`}
                      onClick={() => setInstallMode('interactive')}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setInstallMode('interactive')}
                    >
                      <div className="mode-toggle-title">
                        <CheckCircleOutlined style={{ color: '#059669' }} />
                        <strong>交互式</strong>
                      </div>
                      <span className="mode-toggle-desc">保留官方安装向导，手动选择目标磁盘。</span>
                    </div>
                  </div>

                  <Form.Item name="root_password" label="Root 密码" extra="留空使用默认 niuniu" style={{ marginBottom: 6 }}>
                    <Input.Password placeholder="niuniu" />
                  </Form.Item>

                  <Form.Item
                    name="custom_iso_name"
                    label={
                      <Space size={4}>
                        <span>输出文件名</span>
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

              {/* 4 本次提交摘要 */}
              <div className="pipeline-stage-card pipeline-stage-trigger-card">
                <div className="stage-card-header">
                  <div className="stage-step-badge">4</div>
                  <div className="stage-header-title">
                    <strong>本次提交</strong>
                    <span>核对后运行</span>
                  </div>
                </div>
                <div className="stage-card-body stage-trigger-body">
                  <div className="trigger-formula-summary">
                    <div>
                      版本：<strong>ESXi {version}</strong>
                    </div>
                    <div>
                      基础源：<strong>{selectedDepot ? fileName(selectedDepot.file) : '未选择'}</strong>
                    </div>
                    <div>
                      驱动：<strong>{selectedDrivers.length} 个</strong>
                    </div>
                    <div>
                      模式：<strong>{installMode === 'unattended' ? '无人值守' : '交互式'}</strong>
                    </div>
                  </div>
                  <Button
                    type="primary"
                    size="large"
                    block
                    icon={<PlayCircleOutlined />}
                    loading={createMutation.isPending}
                    onClick={runPipeline}
                    className="big-launch-button"
                  >
                    开始构建
                  </Button>
                </div>
              </div>
            </div>
          </Form>
        </section>

        <section id="pipeline-output" className="pipeline-output-section" aria-label="构建日志与产物">
          {activeTask ? (
            <div className="task-context-bar">
              <Space size={8} wrap align="center">
                <Typography.Text strong>
                  {viewingHistory ? '正在查看历史任务' : '本次提交任务'}
                </Typography.Text>
                <Typography.Text className="mono" copyable style={{ fontSize: 12 }}>
                  {activeTask.task_id}
                </Typography.Text>
                <BuildStatusTag status={activeTask.status} />
                <Tag color="geekblue">ESXi {activeTask.esxi_version}</Tag>
                <Tag>{parseDrivers(activeTask.drivers).length} 个驱动</Tag>
                {activeTask.build_duration ? <Tag>耗时 {activeTask.build_duration}s</Tag> : null}
                {isTaskRunning ? (
                  <Tag color="processing" className="tabular-nums">
                    进度 {displayProgress}%
                  </Tag>
                ) : null}
                {wsState === 'closed' && isTaskRunning && <Tag color="warning">日志连接已断开，正在重连</Tag>}
              </Space>
              <Space size={8} wrap>
                {isTaskRunning && <Progress percent={displayProgress} size="small" style={{ width: 160 }} />}
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => activeTaskQuery.refetch()}
                >
                  刷新
                </Button>
                {viewingHistory && (
                  <Button size="small" onClick={() => setActiveTaskId(submittedTaskId)} disabled={!submittedTaskId}>
                    回到本次任务
                  </Button>
                )}
              </Space>
            </div>
          ) : (
            <div className="task-context-bar task-context-empty">
              <Typography.Text type="secondary">
                还没有本次构建任务。选好配置后点击「运行构建流水线」，日志会显示在这里。
              </Typography.Text>
            </div>
          )}

          {activeTask?.status === 'completed' && activeTask.output_iso && (
            <div className="artifact-banner-card">
              <div className="artifact-banner-main">
                <Space size={8} wrap align="center">
                  <Tag color="success" className="artifact-tag">
                    定制 ISO 构建完成
                  </Tag>
                  <Typography.Text strong className="mono" style={{ fontSize: 13 }}>
                    {activeTask.output_iso}
                  </Typography.Text>
                  {activeTask.output_iso_size ? (
                    <Tag color="blue" className="mono tabular-nums">
                      {(activeTask.output_iso_size / 1024 / 1024).toFixed(1)} MB
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
              <Space size={8} wrap>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={() =>
                    window.open(getBuildArtifactUrl(activeTask.task_id), '_blank', 'noopener,noreferrer')
                  }
                >
                  下载 ISO
                </Button>
                {remoteArtifactUrl && (
                  <Button href={remoteArtifactUrl} target="_blank" rel="noreferrer">
                    公网直链
                  </Button>
                )}
              </Space>
            </div>
          )}

          {activeTask?.status === 'failed' && (
            <Alert
              type="error"
              showIcon
              message="本次构建失败"
              description={activeTask.error_message || '下方日志里可以看到具体失败原因'}
              style={{ marginBottom: 10 }}
            />
          )}

          {activeTask && (
            <PhaseTimingBreakdown
              logs={rawLogs}
              buildDuration={activeTask.build_duration}
              isCompleted={activeTask.status === 'completed'}
            />
          )}

          <div className="log-console-container">
            <div className="log-console-header">
              <Space size={10} wrap align="center">
                <span className="terminal-traffic-lights">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="log-console-title mono">
                  {activeTaskId ? `流水线日志 · ${activeTaskId}` : '流水线日志'}
                </span>
                {activeTask && <BuildStatusTag status={activeTask.status} />}
              </Space>
              <Space size={10} wrap align="center">
                <Segmented<LogViewMode>
                  size="small"
                  value={logViewMode}
                  onChange={setLogViewMode}
                  options={[
                    { value: 'chinese', label: '中文解析' },
                    { value: 'raw', label: '原始日志' },
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
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>自动滚动</span>
                  <Switch size="small" checked={autoScroll} onChange={setAutoScroll} />
                </Space>
                <Tooltip title="复制当前视图日志">
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined style={{ color: '#cbd5e1' }} />}
                    aria-label="复制日志"
                    onClick={copyLogs}
                  />
                </Tooltip>
              </Space>
            </div>

            <div
              ref={logTerminalRef}
              className="log-terminal-body"
              role="log"
              aria-live="polite"
              aria-label="构建日志"
            >
              {logViewMode === 'chinese' ? (
                filteredChineseLogs.length === 0 ? (
                  <div className="terminal-empty-text">
                    {rawLogs.length > 0 ? '当前没有错误或警告' : '等待构建输出…'}
                  </div>
                ) : (
                  filteredChineseLogs.map((item, index) => (
                    <div key={`cn-${index}`} className={`chinese-log-row log-kind-${item.kind}`}>
                      <span className="log-row-badge">{item.badge}</span>
                      <span className="log-row-text">{item.chinese}</span>
                    </div>
                  ))
                )
              ) : filteredRawLogs.length === 0 ? (
                <div className="terminal-empty-text">暂无原始日志</div>
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

      <Drawer
        title="历史流水线"
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        width={820}
        destroyOnClose
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => recentBuildsQuery.refetch()}>
            刷新
          </Button>
        }
      >
        <Table
          size="small"
          rowKey="task_id"
          dataSource={recentBuilds}
          loading={recentBuildsQuery.isLoading}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 640 }}
          rowClassName={(r) => (r.task_id === activeTaskId ? 'ant-table-row-selected' : '')}
          onRow={(r) => ({
            style: { cursor: 'pointer' },
            onClick: () => {
              setActiveTaskId(r.task_id)
              setHistoryDrawerOpen(false)
              window.setTimeout(
                () => document.getElementById('pipeline-output')?.scrollIntoView?.({ behavior: 'smooth' }),
                100
              )
            },
          })}
          columns={[
            {
              title: '任务 / 产物',
              key: 'task',
              render: (_, r: BuildTask) => (
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
            { title: '版本', dataIndex: 'esxi_version', width: 80 },
            {
              title: '状态',
              key: 'status',
              width: 100,
              render: (_, r: BuildTask) => <BuildStatusTag status={r.status} />,
            },
            {
              title: '耗时',
              dataIndex: 'build_duration',
              width: 70,
              render: (d: number | undefined) => (d ? `${d}s` : '-'),
            },
            {
              title: '创建时间',
              dataIndex: 'created_at',
              width: 150,
              render: (t: string) => formatDate(t),
            },
            {
              title: '操作',
              key: 'actions',
              width: 120,
              render: (_, r: BuildTask) => (
                <Space size={4} onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="查看日志">
                    <Button
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => {
                        setActiveTaskId(r.task_id)
                        setHistoryDrawerOpen(false)
                      }}
                    />
                  </Tooltip>
                  {r.status === 'completed' && r.output_iso && (
                    <Tooltip title="下载 ISO">
                      <Button
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={() =>
                          window.open(getBuildArtifactUrl(r.task_id), '_blank', 'noopener,noreferrer')
                        }
                      />
                    </Tooltip>
                  )}
                  <Popconfirm
                    title="删除该构建记录？"
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
      </Drawer>
    </PageContainer>
  )
}
