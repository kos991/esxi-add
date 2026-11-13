import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudDownloadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileZipOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { PageContainer } from '../components/pro-compat'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Descriptions,
  Divider,
  Empty,
  Flex,
  Form,
  Input,
  Popconfirm,
  Progress,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Watermark,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useRef, useState } from 'react'
import { listBuckets } from '../api/buckets'
import {
  createBuild,
  deleteBuild,
  getBuild,
  getBuildArtifactUrl,
  listBuilds,
} from '../api/builds'
import { listDepots, listDrivers } from '../api/files'
import { useWebSocket } from '../hooks/useWebSocket'
import { PhaseTimingBreakdown } from '../components/TaskWorkspace'
import { BuildStatusTag, assetTitle, cacheStatusColor, cacheStatusText, compactSize, esxiVersions, fileName } from './pageUtils'
import type { FileMetadata } from '../types'
import { formatDate } from '../utils'

type DepotOption = {
  key: string
  bucketId: number
  bucketName: string
  file: FileMetadata
}

function depotKey(bucketId: number, file: FileMetadata) {
  return `${bucketId}:${file.id}:${file.path}`
}

function EllipsisText({
  value,
  className,
  strong,
  copyable,
  type,
}: {
  value?: string
  className?: string
  strong?: boolean
  copyable?: boolean
  type?: 'secondary' | 'success' | 'warning' | 'danger'
}) {
  const text = value || '-'
  return (
    <Tooltip title={text}>
      <Typography.Text className={className} strong={strong} type={type} copyable={copyable} ellipsis>
        {text}
      </Typography.Text>
    </Tooltip>
  )
}

export default function BuildPage() {
  const queryClient = useQueryClient()
  const [messageApi, contextHolder] = message.useMessage()
  const [form] = Form.useForm()
  const logTerminalRef = useRef<HTMLDivElement>(null)

  // Build Configuration State
  const [version, setVersion] = useState('8.0')
  const [bucketId, setBucketId] = useState<number | undefined>()
  const [depotPath, setDepotPath] = useState('')
  const [driverPaths, setDriverPaths] = useState<string[]>([])
  const [driverSearch, setDriverSearch] = useState('')
  const [compatibilityFilter, setCompatibilityFilter] = useState<'all' | 'match' | 'attention'>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'local' | 'remote'>('all')

  // Selected Active Task (defaults to latest or newly created)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)

  // Query: Buckets & Depots
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

  const selectedBucketId = bucketId ?? buckets.find((bucket) => bucket.is_default)?.id ?? buckets[0]?.id
  const selectedBucket = buckets.find((bucket) => bucket.id === selectedBucketId)

  // Query: Drivers
  const driversQuery = useQuery({
    queryKey: ['build-drivers', selectedBucketId, version],
    queryFn: () => listDrivers(selectedBucketId as number, version),
    enabled: Boolean(selectedBucketId),
  })
  const selectedDepot = depotOptions.find((item) => item.bucketId === selectedBucketId && item.file.path === depotPath)
  const drivers = driversQuery.data ?? []
  const selectedDrivers = drivers.filter((file) => driverPaths.includes(file.path))

  // Auto-pick first available depot if not selected
  useEffect(() => {
    if (!depotPath && depotOptions.length > 0) {
      setBucketId(depotOptions[0].bucketId)
      setDepotPath(depotOptions[0].file.path)
    }
  }, [depotOptions, depotPath])

  // Query: Recent Builds List
  const recentBuildsQuery = useQuery({
    queryKey: ['builds-recent'],
    queryFn: () => listBuilds(1, 10),
    refetchInterval: activeTaskId ? 2000 : 8000,
  })

  const recentBuilds = recentBuildsQuery.data?.items ?? []

  // Auto-select latest build if no active task
  useEffect(() => {
    if (!activeTaskId && recentBuilds.length > 0) {
      setActiveTaskId(recentBuilds[0].task_id)
    }
  }, [activeTaskId, recentBuilds])

  // Active Task Detail Query & WebSocket Logs
  const activeTaskQuery = useQuery({
    queryKey: ['build-active', activeTaskId],
    queryFn: () => getBuild(activeTaskId!),
    enabled: Boolean(activeTaskId),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' || query.state.data?.status === 'pending' ? 1000 : false,
  })
  const activeTask = activeTaskQuery.data
  const { logs: wsLogs, progress: wsProgress } = useWebSocket(activeTaskId ?? null)

  const displayLogs = useMemo(() => {
    if (wsLogs && wsLogs.length > 0) return wsLogs
    return activeTask?.log_output ? activeTask.log_output.split('\n').filter(Boolean) : []
  }, [wsLogs, activeTask?.log_output])

  const displayProgress = wsProgress || activeTask?.progress || 0

  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight
    }
  }, [displayLogs])

  // Mutation: Create Build
  const createMutation = useMutation({
    mutationFn: createBuild,
    onSuccess: (task) => {
      setActiveTaskId(task.task_id)
      messageApi.success('构建任务已创建！正在极速封装中...')
      queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
    },
    onError: (error) => messageApi.error(String(error)),
  })

  // Mutation: Delete Build
  const deleteBuildMutation = useMutation({
    mutationFn: deleteBuild,
    onSuccess: (_, deletedTaskId) => {
      messageApi.success('任务已删除')
      if (activeTaskId === deletedTaskId) {
        setActiveTaskId(null)
      }
      queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
    },
    onError: (error) => messageApi.error(String(error)),
  })

  // Driver Table Filters
  const driverIsAttention = (file: FileMetadata) => Boolean(file.conflicts_with || file.depends_on || file.cache_status === 'missing')
  const driverSource = (file: FileMetadata) => (file.cached || selectedBucket?.type === 'local' ? 'local' : 'remote')
  const filteredDrivers = drivers.filter((file) => {
    const keyword = driverSearch.trim().toLowerCase()
    const matchesKeyword =
      !keyword ||
      file.path.toLowerCase().includes(keyword) ||
      (file.driver_name && file.driver_name.toLowerCase().includes(keyword)) ||
      (file.driver_description && file.driver_description.toLowerCase().includes(keyword))
    const matchesCompatibility =
      compatibilityFilter === 'all' ||
      (compatibilityFilter === 'match' && !driverIsAttention(file)) ||
      (compatibilityFilter === 'attention' && driverIsAttention(file))
    const matchesSource = sourceFilter === 'all' || driverSource(file) === sourceFilter
    return matchesKeyword && matchesCompatibility && matchesSource
  })

  const driverColumns: ColumnsType<FileMetadata> = [
    {
      title: '驱动包名称',
      key: 'name',
      render: (_, file) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong className="driver-title">
            {file.driver_name || fileName(file)}
          </Typography.Text>
          <EllipsisText className="mono driver-path" type="secondary" value={file.path} copyable />
        </Space>
      ),
    },
    {
      title: '版本',
      dataIndex: 'driver_version',
      width: 110,
      render: (value: string | undefined) => <span className="mono driver-version">{value || '-'}</span>,
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 90,
      render: (value: number | undefined) => compactSize(value),
    },
    {
      title: '兼容性',
      key: 'compatibility',
      width: 120,
      render: (_, file) =>
        driverIsAttention(file) ? (
          <Tag color="warning">需确认</Tag>
        ) : (
          <Tag color="success">已匹配</Tag>
        ),
    },
  ]

  const nowTimestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const formulaPlaceholder = `ESXi-${version}-custom-${nowTimestamp}.iso`

  const submitBuild = () => {
    if (!depotPath) {
      messageApi.warning('请选择基础镜像源文件 (ISO 或 Depot)')
      return
    }
    form.validateFields().then((values) => {
      createMutation.mutate({
        bucket_id: selectedBucketId as number,
        esxi_version: version,
        depot_path: depotPath,
        driver_paths: driverPaths,
        custom_iso_name: values.custom_iso_name ? values.custom_iso_name.trim() : undefined,
        root_password: values.root_password ? values.root_password.trim() : 'niuniu',
        install_mode: values.install_mode || 'unattended',
      })
    })
  }

  return (
    <PageContainer
      title="构建自定义 ESXi ISO"
      subTitle="一体化构建控制台：配置镜像源与驱动，毫秒级参数解析，原地实时日志流与产物下载。"
    >
      {contextHolder}
      <Watermark
        className="build-watermark"
        content={['ESXi Builder', 'Unified Console']}
        font={{ color: 'rgba(15, 23, 42, 0.04)', fontSize: 15, fontWeight: 500 }}
        gap={[180, 120]}
        rotate={-18}
      >
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          {/* Section 1: Build Configuration Card */}
          <Card
            title={
              <Space size={8}>
                <ToolOutlined style={{ color: '#1677ff' }} />
                <Typography.Text strong>新建定制构建配置</Typography.Text>
                <Tag color="green">Linux 原生极速引擎 (5~10 秒)</Tag>
              </Space>
            }
            extra={
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                size="middle"
                onClick={submitBuild}
                loading={createMutation.isPending}
              >
                开始极速构建
              </Button>
            }
          >
            <Form
              form={form}
              layout="vertical"
              initialValues={{
                custom_iso_name: '',
                root_password: 'niuniu',
                install_mode: 'unattended',
              }}
            >
              <Flex gap={20} wrap="wrap">
                {/* 1. Base Image selection */}
                <div style={{ flex: '1 1 360px', minWidth: 320 }}>
                  <Form.Item label="ESXi 基础版本" required style={{ marginBottom: 12 }}>
                    <Select
                      value={version}
                      onChange={(value) => {
                        setVersion(value)
                        setDepotPath('')
                        setDriverPaths([])
                      }}
                      options={esxiVersions.map((item) => ({ value: item, label: `ESXi ${item}` }))}
                    />
                  </Form.Item>
                  <Form.Item label="基础镜像源文件 (ISO / Depot)" required style={{ marginBottom: 12 }}>
                    <Select
                      showSearch
                      value={selectedDepot?.key}
                      placeholder="选择已有的基础 ISO 或 Depot 文件"
                      loading={bucketsQuery.isLoading || depotQueries.some((q) => q.isLoading)}
                      onChange={(val) => {
                        const opt = depotOptions.find((item) => item.key === val)
                        setBucketId(opt?.bucketId)
                        setDepotPath(opt?.file.path ?? '')
                      }}
                      optionFilterProp="label"
                      options={depotOptions.map((item) => ({
                        value: item.key,
                        label: `${item.bucketName} / ${fileName(item.file)}`,
                      }))}
                    />
                  </Form.Item>
                  {selectedDepot && (
                    <div style={{ padding: '6px 12px', background: '#f8fafc', borderRadius: 6, marginBottom: 12 }}>
                      <Space size={8} wrap>
                        <Tag color="blue">{selectedDepot.bucketName}</Tag>
                        <Tag color={cacheStatusColor(selectedDepot.file, selectedBucket)}>{cacheStatusText(selectedDepot.file, selectedBucket)}</Tag>
                        <Typography.Text code className="mono" style={{ fontSize: 11 }}>{selectedDepot.file.path}</Typography.Text>
                      </Space>
                    </div>
                  )}
                  <Form.Item
                    name="custom_iso_name"
                    label="输出镜像名称"
                    extra="支持自定义命名。留空将自动按公式命名：ESXi-{版本}-custom-{时间戳}.iso"
                  >
                    <Input className="mono" placeholder={formulaPlaceholder} allowClear />
                  </Form.Item>
                </div>

                {/* 2. Drivers Selection */}
                <div style={{ flex: '2 1 500px', minWidth: 360 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Typography.Text strong>注入驱动包 ({selectedDrivers.length}/{drivers.length} 已选)</Typography.Text>
                    <Space size={8}>
                      <Input
                        size="small"
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder="搜索驱动"
                        style={{ width: 160 }}
                        value={driverSearch}
                        onChange={(e) => setDriverSearch(e.target.value)}
                      />
                      <Button
                        size="small"
                        onClick={() => {
                          const currentPaths = filteredDrivers.map((d) => d.path)
                          const allSelected = currentPaths.every((p) => driverPaths.includes(p))
                          if (allSelected) {
                            setDriverPaths(driverPaths.filter((p) => !currentPaths.includes(p)))
                          } else {
                            setDriverPaths(Array.from(new Set([...driverPaths, ...currentPaths])))
                          }
                        }}
                      >
                        {filteredDrivers.every((d) => driverPaths.includes(d.path)) && filteredDrivers.length > 0 ? '取消全选' : '全选当前'}
                      </Button>
                    </Space>
                  </div>
                  <Table
                    size="small"
                    rowKey="path"
                    bordered
                    pagination={false}
                    scroll={{ y: 200 }}
                    loading={driversQuery.isLoading}
                    dataSource={filteredDrivers}
                    columns={driverColumns}
                    rowSelection={{
                      selectedRowKeys: driverPaths,
                      onChange: (keys) => setDriverPaths(keys as string[]),
                    }}
                  />
                </div>
              </Flex>

              {/* Advanced Parameters Collapse */}
              <Collapse defaultActiveKey={["advanced"]}
                ghost
                style={{ marginTop: 12 }}
                items={[
                  {
                    key: 'advanced',
                    label: (
                      <Space size={6}>
                        <SettingOutlined />
                        <Typography.Text strong>核心安装参数调整 (Root 密码 / 安装模式)</Typography.Text>
                      </Space>
                    ),
                    children: (
                      <Flex gap={24} wrap="wrap" style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: 6 }}>
                        <div style={{ minWidth: 260, flex: 1 }}>
                          <Form.Item
                            name="root_password"
                            label="Root 初始管理密码"
                            extra="系统安装后默认 root 密码，默认值为 niuniu"
                            style={{ marginBottom: 0 }}
                          >
                            <Input.Password placeholder="niuniu" />
                          </Form.Item>
                        </div>
                        <div style={{ minWidth: 320, flex: 2 }}>
                          <Form.Item
                            name="install_mode"
                            label="安装模式选择"
                            extra="控制 ESXi 开机安装时的自动化行为"
                            style={{ marginBottom: 0 }}
                          >
                            <Radio.Group>
                              <Space direction="vertical">
                                <Radio value="unattended">
                                  <Typography.Text strong>⚡ 无人值守自动安装 (推荐)</Typography.Text>
                                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                                    开机全自动格式化第一块本地磁盘，装完自动重启并在首次开机自动注册驱动
                                  </Typography.Text>
                                </Radio>
                                <Radio value="interactive">
                                  <Typography.Text strong>🖥️ 交互式手动安装</Typography.Text>
                                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                                    保留官方原厂图形安装向导，可手动选择目标磁盘和确认，驱动仍预载以通过网卡检测
                                  </Typography.Text>
                                </Radio>
                              </Space>
                            </Radio.Group>
                          </Form.Item>
                        </div>
                      </Flex>
                    ),
                  },
                ]}
              />
            </Form>
          </Card>

          {/* Section 2: Active Build Task & Live Log Console (Merged) */}
          <Card
            title={
              <Space wrap size={10}>
                <ClockCircleOutlined style={{ color: '#1677ff', fontSize: 16 }} />
                <Typography.Text strong style={{ fontSize: 15 }}>构建任务控制台与实时日志</Typography.Text>
                {activeTaskId && <Typography.Text code className="mono">{activeTaskId}</Typography.Text>}
                {activeTask?.status && <BuildStatusTag status={activeTask.status} />}
              </Space>
            }
            extra={
              <Space wrap size={8}>
                {activeTask?.status === 'completed' && activeTask?.output_iso && (
                  <Button
                    type="primary"
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
                    queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
                  }}
                >
                  刷新
                </Button>
              </Space>
            }
          >
            {activeTaskId ? (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Descriptions
                  size="small"
                  bordered
                  column={{ xxl: 4, xl: 4, lg: 2, md: 2, sm: 1, xs: 1 }}
                  items={[
                    { key: 'name', label: '镜像名称', children: activeTask?.custom_iso_name || '默认公式命名' },
                    { key: 'version', label: 'ESXi 版本', children: activeTask?.esxi_version || '-' },
                    { key: 'duration', label: '构建总耗时', children: activeTask?.build_duration ? `${activeTask.build_duration} 秒` : '-' },
                    { key: 'progress', label: '构建进度', children: `${displayProgress}%` },
                  ]}
                />

                <Progress
                  percent={displayProgress}
                  status={activeTask?.status === 'failed' ? 'exception' : activeTask?.status === 'completed' ? 'success' : 'active'}
                  strokeColor={{ '0%': '#108ee9', '100%': '#87d068' }}
                />

                <PhaseTimingBreakdown
                  logs={displayLogs}
                  buildDuration={activeTask?.build_duration}
                  isCompleted={activeTask?.status === 'completed'}
                />

                {activeTask?.status === 'completed' && activeTask?.output_iso && (
                  <Alert
                    type="success"
                    showIcon
                    message="🎉 定制 ESXi ISO 已构建完成！"
                    description={
                      <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 8 }}>
                        <div>
                          <Typography.Text strong>产物文件：</Typography.Text>
                          <Typography.Text code className="mono">{activeTask.output_iso}</Typography.Text>
                          {activeTask.output_iso_size && (
                            <Tag color="blue" style={{ marginLeft: 8 }}>
                              {(activeTask.output_iso_size / 1024 / 1024).toFixed(1)} MB
                            </Tag>
                          )}
                        </div>
                        {activeTask.output_iso_sha256 && (
                          <div>
                            <Typography.Text strong>SHA-256：</Typography.Text>
                            <Typography.Text code copyable className="mono">
                              {activeTask.output_iso_sha256}
                            </Typography.Text>
                          </div>
                        )}
                        <div style={{ marginTop: 8 }}>
                          <Button
                            type="primary"
                            size="large"
                            icon={<DownloadOutlined />}
                            onClick={() => window.open(getBuildArtifactUrl(activeTask.task_id), '_blank', 'noopener,noreferrer')}
                          >
                            立即下载定制 ISO
                          </Button>
                        </div>
                      </Space>
                    }
                  />
                )}

                {activeTask?.status === 'failed' && (
                  <Alert
                    type="error"
                    showIcon
                    message="构建失败"
                    description={activeTask.error_message || '请检查下方日志输出获取详细失败原因'}
                  />
                )}

                <div>
                  <Typography.Text strong style={{ marginBottom: 8, display: 'block' }}>
                    实时构建日志：
                  </Typography.Text>
                  <div
                    ref={logTerminalRef}
                    style={{
                      backgroundColor: '#0f172a',
                      color: '#e2e8f0',
                      fontFamily: 'Consolas, Monaco, monospace',
                      fontSize: 12,
                      lineHeight: '1.6',
                      padding: '12px 16px',
                      borderRadius: 6,
                      maxHeight: 260,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {displayLogs.length === 0 ? (
                      <Typography.Text type="secondary" style={{ color: '#64748b' }}>
                        等待日志输出...
                      </Typography.Text>
                    ) : (
                      displayLogs.map((log, index) => <div key={index}>{log}</div>)
                    )}
                  </div>
                </div>
              </Space>
            ) : (
              <Empty description="暂无活动任务，请在上方配置并点击「开始极速构建」，或在下方选择历史任务查看" />
            )}
          </Card>

          {/* Section 3: Recent Builds History Table */}
          <Card
            title={
              <Space size={8}>
                <ClockCircleOutlined />
                <Typography.Text strong>近期构建任务</Typography.Text>
              </Space>
            }
            extra={
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => queryClient.invalidateQueries({ queryKey: ['builds-recent'] })}
              >
                刷新列表
              </Button>
            }
          >
            <Table
              size="small"
              rowKey="task_id"
              loading={recentBuildsQuery.isLoading}
              dataSource={recentBuilds}
              pagination={{ pageSize: 5 }}
              columns={[
                {
                  title: '镜像名称 / ID',
                  key: 'name',
                  render: (_, r: any) => (
                    <Space direction="vertical" size={0}>
                      <Typography.Text strong ellipsis style={{ maxWidth: 280 }}>
                        {r.custom_iso_name || `ESXi-${r.esxi_version || '8.0'}`}
                      </Typography.Text>
                      <Typography.Text type="secondary" className="mono" style={{ fontSize: 11 }}>
                        {r.task_id}
                      </Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: '版本',
                  dataIndex: 'esxi_version',
                  width: 90,
                  render: (v) => <Tag color="geekblue">{v || '8.0'}</Tag>,
                },
                {
                  title: '状态',
                  key: 'status',
                  width: 110,
                  render: (_, r: any) => <BuildStatusTag status={r.status} />,
                },
                {
                  title: '耗时',
                  dataIndex: 'build_duration',
                  width: 90,
                  render: (d) => (d ? `${d} 秒` : '-'),
                },
                {
                  title: '创建时间',
                  dataIndex: 'created_at',
                  width: 170,
                  render: (t) => formatDate(t),
                },
                {
                  title: '操作',
                  key: 'actions',
                  width: 180,
                  render: (_, r: any) => (
                    <Space wrap size={4}>
                      <Button
                        size="small"
                        type={activeTaskId === r.task_id ? 'primary' : 'default'}
                        icon={<EyeOutlined />}
                        onClick={() => {
                          setActiveTaskId(r.task_id)
                          window.scrollTo({ top: 350, behavior: 'smooth' })
                        }}
                      >
                        {activeTaskId === r.task_id ? '当前查看' : '查看日志'}
                      </Button>
                      {r.status === 'completed' && r.output_iso && (
                        <Button
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={() => window.open(getBuildArtifactUrl(r.task_id), '_blank', 'noopener,noreferrer')}
                        >
                          下载
                        </Button>
                      )}
                      <Popconfirm
                        title="确认删除任务记录？"
                        onConfirm={() => deleteBuildMutation.mutate(r.task_id)}
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
        </Space>
      </Watermark>
    </PageContainer>
  )
}
