import {
  CheckCircleFilled,
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
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Progress,
  Segmented,
  Space,
  Steps,
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
import { PageHeader } from '../components/PageHeader'
import { PhaseTimingBreakdown } from '../components/TaskWorkspace'
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

/** 从来源路径推断实际会用的引擎，用于第 1 步直接告诉用户耗时量级。 */
function engineOf(path: string): { label: string; tag: string; color: string } {
  if (path.toLowerCase().endsWith('.iso')) {
    return { label: 'ISO → 原生引擎（约 5~10 秒）', tag: '原生', color: 'cyan' }
  }
  return { label: 'Depot → PowerCLI（约 1~2 分钟）', tag: 'PowerCLI', color: 'amber' }
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

  // 配方
  const [step, setStep] = useState(1)
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

  // 任务查看
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
  const displayProgress = isTaskRunning
    ? Math.max(wsProgress || 0, activeTask?.progress || 0)
    : activeTask?.progress ?? 0

  const rawLogs = useMemo(() => {
    const fromTask = activeTask?.log_output ? activeTask.log_output.split('\n').filter(Boolean) : []
    if (wsLogs.length > 0 && activeTaskId === submittedTaskId) return wsLogs
    return fromTask
  }, [wsLogs, activeTask?.log_output, activeTaskId, submittedTaskId])

  const chineseLogs = useMemo(() => dedupeChineseLogs(rawLogs.map(formatLogToChinese)), [rawLogs])
  const filteredChineseLogs = useMemo(
    () =>
      logFilter === 'all'
        ? chineseLogs
        : chineseLogs.filter((i) => i.kind === 'error' || i.kind === 'warn'),
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
          <Typography.Text strong ellipsis style={{ maxWidth: 280 }}>
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
      width: 88,
      render: (v) => <span className="mono tabular-nums">{v || '-'}</span>,
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 84,
      render: (v) => <span className="mono tabular-nums">{compactSize(v)}</span>,
    },
    {
      title: '标记',
      key: 'flag',
      width: 90,
      render: (_, file) =>
        file.conflicts_with || file.depends_on || file.cache_status === 'missing' ? (
          <Tooltip title="存在冲突、依赖或缓存缺失标记">
            <Tag color="warning">待确认</Tag>
          </Tooltip>
        ) : (
          <Tooltip title="无冲突或依赖标记，不代表已验证硬件兼容性">
            <Tag>无标记</Tag>
          </Tooltip>
        ),
    },
  ]

  const nowTimestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const formulaPlaceholder = `ESXi-${version}-custom-${nowTimestamp}.iso`

  const runPipeline = () => {
    if (!depotPath || !selectedBucketId) {
      messageApi.warning('请先在第 1 步选择基础镜像')
      setStep(1)
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

  const customName = Form.useWatch('custom_iso_name', form)
  const rootPwd = Form.useWatch('root_password', form)

  const stepItems = [
    { title: '基础镜像', description: '版本与安装源' },
    { title: '驱动注入', description: '可选' },
    { title: '安装参数', description: '模式与命名' },
    { title: '确认并运行', description: '核对后执行' },
  ]

  const canLeaveStep1 = Boolean(depotPath)

  return (
    <div className="page-shell">
      {contextHolder}

      <PageHeader
        title="构建流水线"
        subTitle="按步骤完成配置，最后确认后运行，日志在同页下方输出"
        extra={
          <>
            <Button icon={<HistoryOutlined />} onClick={() => setHistoryDrawerOpen(true)}>
              历史流水线（{recentBuilds.length}）
            </Button>
            <Button icon={<CloudUploadOutlined />} onClick={() => go('/storage')}>
              存储与挂载
            </Button>
          </>
        }
      />

      <Card className="wizard-card" variant="outlined">
        <Steps
          current={step - 1}
          items={stepItems}
          size="small"
          responsive={false}
          labelPlacement="horizontal"
          onChange={(n) => {
            const target = n + 1
            if (target <= step) setStep(target)
            else if (canLeaveStep1) setStep(target)
          }}
          className="wizard-steps"
        />

        <div className="wizard-body">
          <div className="wizard-body-head">
            <Typography.Text strong>{`第 ${step} 步 · ${stepItems[step - 1].title}`}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {step === 1 && '原生引擎只接受 ISO；Depot ZIP 会自动使用 PowerCLI'}
              {step === 2 && '默认不注入。勾选后会打进镜像并在首次启动时注册'}
              {step === 3 && '决定安装自动化程度、root 密码与输出文件名'}
              {step === 4 && '请核对下面每一项，确认后点击开始构建'}
            </Typography.Text>
          </div>

          {/* 步骤 1 */}
          {step === 1 && (
            <div className="wizard-stage">
              <label className="field-label">目标 ESXi 版本</label>
              <Segmented
                block
                value={version}
                onChange={(v) => {
                  setVersion(String(v))
                  setDepotPath('')
                  setDriverPaths([])
                  setPreflightId(null)
                }}
                options={esxiVersions.map((v) => ({ value: v, label: v }))}
              />

              <label className="field-label" style={{ marginTop: 16 }}>
                选择安装源
              </label>

              {depotOptions.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={`暂无 ESXi ${version} 的可用镜像源`}
                >
                  <Button type="primary" onClick={() => go('/storage')} icon={<CloudUploadOutlined />}>
                    去存储上传
                  </Button>
                </Empty>
              ) : (
                <div className="source-card-list" role="radiogroup" aria-label="安装源">
                  {depotOptions.map((item) => {
                    const active = item.key === selectedDepot?.key
                    const engine = engineOf(item.file.path)
                    return (
                      <div
                        key={item.key}
                        role="radio"
                        aria-checked={active}
                        tabIndex={0}
                        className={`source-card ${active ? 'source-card-active' : ''}`}
                        onClick={() => {
                          setBucketId(item.bucketId)
                          setDepotPath(item.file.path)
                          setDriverPaths([])
                          setPreflightId(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setBucketId(item.bucketId)
                            setDepotPath(item.file.path)
                            setDriverPaths([])
                            setPreflightId(null)
                          }
                        }}
                      >
                        <div className="source-icon">{engine.tag}</div>
                        <div className="source-body">
                          <strong>{fileName(item.file)}</strong>
                          <code className="mono">{item.file.path}</code>
                          <Space size={6} wrap style={{ marginTop: 4 }}>
                            <Tag color={item.bucketType === 's3' ? 'cyan' : 'blue'}>
                              {item.bucketType === 's3' ? 'S3 挂载' : '本地存储'} · {item.bucketName}
                            </Tag>
                            <Tag color={cacheStatusColor(item.file, selectedBucket)}>
                              {cacheStatusText(item.file, selectedBucket)}
                            </Tag>
                            {item.file.size ? (
                              <Tag className="mono tabular-nums">{compactSize(item.file.size)}</Tag>
                            ) : null}
                            <Tag color={engine.color}>{engine.label}</Tag>
                          </Space>
                        </div>
                        <span className="source-check">{active ? <CheckCircleFilled /> : null}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {selectedDepot && (
                <div className="preflight-bar">
                  <Button
                    size="small"
                    icon={<SafetyCertificateOutlined />}
                    loading={preflightMutation.isPending}
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
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      参数已变更，需重新预检
                    </Typography.Text>
                  )}
                  {preflightFresh && preflightQuery.data && (
                    <Alert
                      style={{ flex: 1, minWidth: 200 }}
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
                      style={{ flex: 1, minWidth: 200 }}
                      type="error"
                      showIcon
                      message={`预检查询失败：${String(preflightQuery.error)}`}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* 步骤 2 */}
          {step === 2 && (
            <div className="wizard-stage">
              <div className="driver-toolbar-mini">
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="搜索驱动包名称或路径"
                  value={driverSearch}
                  onChange={(e) => setDriverSearch(e.target.value)}
                  style={{ flex: 1, minWidth: 180 }}
                />
                <Button
                  onClick={() => {
                    const paths = filteredDrivers.map((d) => d.path)
                    if (allDriversSelected) {
                      setDriverPaths(effectiveDriverPaths.filter((p) => !paths.includes(p)))
                    } else {
                      setDriverPaths(Array.from(new Set([...effectiveDriverPaths, ...paths])))
                    }
                  }}
                >
                  {allDriversSelected ? '取消全选' : '全选当前'}
                </Button>
                <Button type="text" danger disabled={effectiveDriverPaths.length === 0} onClick={() => setDriverPaths([])}>
                  清空
                </Button>
                <span
                  className="driver-count"
                  aria-label={`已选 ${selectedDrivers.length} 个`}
                >
                  已选 <strong>{selectedDrivers.length}</strong> 个
                </span>
              </div>

              <Table
                size="small"
                rowKey="path"
                bordered
                pagination={false}
                scroll={{ y: 260 }}
                loading={driversQuery.isLoading}
                dataSource={filteredDrivers}
                columns={driverColumns}
                rowSelection={{
                  selectedRowKeys: effectiveDriverPaths,
                  onChange: (keys) => setDriverPaths(keys as string[]),
                }}
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={driversQuery.isError ? '驱动加载失败' : '当前版本暂无可选驱动（可以不选直接构建）'}
                    />
                  ),
                }}
              />

              {selectedDrivers.length > 0 && (
                <div className="selected-chips">
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

              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                「无标记」只表示没有冲突或依赖标记，不代表已验证硬件兼容性。
              </Typography.Text>
            </div>
          )}

          {/* 步骤 3 */}
          {step === 3 && (
            <div className="wizard-stage">
              <label className="field-label">安装模式</label>
              <div className="mode-grid">
                <div
                  role="radio"
                  aria-checked={installMode === 'unattended'}
                  tabIndex={0}
                  className={`mode-card ${installMode === 'unattended' ? 'mode-card-active' : ''}`}
                  onClick={() => setInstallMode('unattended')}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setInstallMode('unattended')}
                >
                  <strong>
                    <ThunderboltOutlined style={{ color: '#2563eb' }} /> 无人值守
                  </strong>
                  <span>开机自动格式化首块磁盘完成安装，首次启动自动注册驱动。</span>
                </div>
                <div
                  role="radio"
                  aria-checked={installMode === 'interactive'}
                  tabIndex={0}
                  className={`mode-card ${installMode === 'interactive' ? 'mode-card-active' : ''}`}
                  onClick={() => setInstallMode('interactive')}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setInstallMode('interactive')}
                >
                  <strong>
                    <CheckCircleOutlined style={{ color: '#059669' }} /> 交互式
                  </strong>
                  <span>保留官方图形安装向导，手动选择目标磁盘，驱动照常预载。</span>
                </div>
              </div>

              <Form form={form} layout="vertical" initialValues={{ root_password: 'niuniu', custom_iso_name: '' }}>
                <div className="param-two-col">
                  <Form.Item name="root_password" label="Root 密码" extra="留空使用默认 niuniu">
                    <Input.Password placeholder="niuniu" />
                  </Form.Item>
                  <Form.Item
                    name="custom_iso_name"
                    label={
                      <Space size={6}>
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
                  >
                    <Input className="mono" placeholder={formulaPlaceholder} allowClear />
                  </Form.Item>
                </div>
              </Form>
            </div>
          )}

          {/* 步骤 4 */}
          {step === 4 && (
            <div className="wizard-stage">
              <Descriptions bordered size="small" column={1} className="confirm-desc">
                <Descriptions.Item label="ESXi 版本">ESXi {version}</Descriptions.Item>
                <Descriptions.Item label="基础镜像">
                  <div className="table-cell-stack">
                    <Typography.Text strong>{selectedDepot ? fileName(selectedDepot.file) : '未选择'}</Typography.Text>
                    <Typography.Text type="secondary" className="mono" style={{ fontSize: 11 }}>
                      {depotPath || '-'}
                    </Typography.Text>
                  </div>
                </Descriptions.Item>
                <Descriptions.Item label="实际引擎">
                  <Tag color={engineOf(depotPath).color}>{engineOf(depotPath).label}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="注入驱动">
                  {selectedDrivers.length === 0
                    ? '不注入驱动'
                    : selectedDrivers.map((d) => d.driver_name || fileName(d)).join('、')}
                </Descriptions.Item>
                <Descriptions.Item label="安装模式">
                  {installMode === 'unattended' ? '无人值守（自动格式化首块磁盘）' : '交互式（手动选择磁盘）'}
                </Descriptions.Item>
                <Descriptions.Item label="Root 密码">
                  <span className="mono">{rootPwd || 'niuniu'}</span>
                </Descriptions.Item>
                <Descriptions.Item label="输出文件名">
                  <span className="mono">{customName?.trim() || `${formulaPlaceholder}（自动）`}</span>
                </Descriptions.Item>
              </Descriptions>

              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 12 }}
                message="构建会覆盖同名输出文件"
                description="输出路径已存在时任务会直接失败，不会复用旧产物；日志会打印实际使用的基础镜像。"
              />

              <Button
                type="primary"
                size="large"
                block
                icon={<PlayCircleOutlined />}
                style={{ marginTop: 14, height: 46, fontSize: 15 }}
                loading={createMutation.isPending}
                onClick={runPipeline}
              >
                开始构建
              </Button>
            </div>
          )}
        </div>

        <div className="wizard-footer">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            ESXi {version} · {selectedDrivers.length} 个驱动 ·{' '}
            {installMode === 'unattended' ? '无人值守' : '交互式'}
          </Typography.Text>
          <Space>
            <Button disabled={step === 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>
              上一步
            </Button>
            {step < 4 && (
              <Button
                type="primary"
                disabled={step === 1 && !canLeaveStep1}
                onClick={() => setStep((s) => Math.min(4, s + 1))}
              >
                下一步
              </Button>
            )}
          </Space>
        </div>
      </Card>

      {/* 日志与产物 */}
      <section id="pipeline-output" className="pipeline-output-section" aria-label="构建日志与产物">
        {activeTask ? (
          <div className="task-context-bar">
            <Space size={8} wrap align="center">
              <Typography.Text strong>{viewingHistory ? '正在查看历史任务' : '本次提交任务'}</Typography.Text>
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
              {wsState === 'closed' && isTaskRunning && <Tag color="warning">日志连接断开，正在重连</Tag>}
            </Space>
            <Space size={8} wrap>
              {isTaskRunning && <Progress percent={displayProgress} size="small" style={{ width: 150 }} />}
              <Button size="small" icon={<ReloadOutlined />} onClick={() => activeTaskQuery.refetch()}>
                刷新
              </Button>
              {viewingHistory && (
                <Button size="small" disabled={!submittedTaskId} onClick={() => setActiveTaskId(submittedTaskId)}>
                  回到本次任务
                </Button>
              )}
            </Space>
          </div>
        ) : (
          <div className="task-context-bar task-context-empty">
            <Typography.Text type="secondary">
              还没有本次构建任务。走完四步后点击「开始构建」，日志会显示在这里。
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

          <div ref={logTerminalRef} className="log-terminal-body" role="log" aria-live="polite" aria-label="构建日志">
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
            { title: '创建时间', dataIndex: 'created_at', width: 150, render: (t: string) => formatDate(t) },
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
    </div>
  )
}
