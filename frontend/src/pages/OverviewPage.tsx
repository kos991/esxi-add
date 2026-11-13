import {
  ApartmentOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileZipOutlined,
  ReloadOutlined,
  RocketOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Empty, Progress, Segmented, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo, useState } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import { listBuckets } from '../api/buckets'
import { getBuildArtifactUrl, listBuilds } from '../api/builds'
import { listDepots, listDrivers } from '../api/files'
import { getSystemStatus } from '../api/system'
import { PageContainer, ProCard } from '../components/pro-compat'
import type { BuildTask } from '../types'
import { formatBytes, formatDate } from '../utils'
import { BuildStatusTag } from './pageUtils'

type StatusFilter = 'all' | 'running' | 'completed' | 'failed'

export default function OverviewPage() {
  const inRouter = useInRouterContext()
  const routerNavigate = inRouter ? useNavigate() : null
  const go = (path: string) => {
    if (routerNavigate) {
      routerNavigate(path)
    } else {
      window.location.assign(path)
    }
  }

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const buildsQuery = useQuery({
    queryKey: ['overview-builds'],
    queryFn: () => listBuilds(1, 20),
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
  })
  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const systemQuery = useQuery({
    queryKey: ['system-status'],
    queryFn: getSystemStatus,
    refetchInterval: 4000,
    refetchIntervalInBackground: false,
    retry: false,
  })

  const buckets = bucketsQuery.data ?? []
  const defaultBucket = useMemo(
    () => buckets.find((item) => item.is_default) ?? buckets[0],
    [buckets]
  )

  const depotsQuery = useQuery({
    queryKey: ['depots', defaultBucket?.id],
    queryFn: () => listDepots(defaultBucket!.id),
    enabled: Boolean(defaultBucket?.id),
  })
  const driversQuery = useQuery({
    queryKey: ['drivers', defaultBucket?.id, 'all'],
    queryFn: () => listDrivers(defaultBucket!.id),
    enabled: Boolean(defaultBucket?.id),
  })

  const stats = useMemo(() => {
    const tasks = buildsQuery.data?.items ?? []
    const completed = tasks.filter((task) => task.status === 'completed').length
    const failed = tasks.filter((task) => task.status === 'failed').length
    const running = tasks.filter((task) => task.status === 'running' || task.status === 'pending').length
    const totalFinished = completed + failed
    const successRate = totalFinished === 0 ? 100 : Math.round((completed / totalFinished) * 100)

    return {
      total: buildsQuery.data?.total ?? tasks.length,
      completed,
      failed,
      running,
      successRate,
      buckets: buckets.length,
      depots: depotsQuery.data?.length ?? 0,
      drivers: driversQuery.data?.length ?? 0,
    }
  }, [buildsQuery.data, buckets.length, depotsQuery.data, driversQuery.data])

  const filteredTasks = useMemo(() => {
    const tasks = buildsQuery.data?.items ?? []
    if (statusFilter === 'all') return tasks
    if (statusFilter === 'running') {
      return tasks.filter((t) => t.status === 'running' || t.status === 'pending')
    }
    return tasks.filter((t) => t.status === statusFilter)
  }, [buildsQuery.data, statusFilter])

  const columns: ColumnsType<BuildTask> = [
    {
      title: '镜像名称 / 任务 ID',
      key: 'task',
      render: (_, task) => (
        <div className="table-cell-stack">
          <Typography.Text strong ellipsis style={{ maxWidth: 260 }}>
            {task.custom_iso_name || `ESXi-${task.esxi_version || '8.0'}-custom.iso`}
          </Typography.Text>
          <Typography.Text type="secondary" className="mono" style={{ fontSize: 11 }}>
            {task.task_id}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '版本',
      dataIndex: 'esxi_version',
      width: 86,
      render: (val: string) => <Tag color="geekblue">{val || '8.0'}</Tag>,
    },
    {
      title: '状态',
      width: 108,
      render: (_, task) => <BuildStatusTag status={task.status} />,
    },
    {
      title: '进度 / 耗时',
      width: 165,
      render: (_, task) => (
        <div className="table-cell-stack">
          <Progress
            percent={task.progress || 0}
            size="small"
            status={task.status === 'failed' ? 'exception' : task.status === 'completed' ? 'success' : 'active'}
          />
          {task.build_duration ? (
            <Typography.Text type="secondary" className="mono tabular-nums" style={{ fontSize: 11 }}>
              耗时 {task.build_duration}s
            </Typography.Text>
          ) : null}
        </div>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 165,
      render: (value: string) => (
        <span className="tabular-nums" style={{ color: '#64748b', fontSize: 12 }}>
          {formatDate(value)}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_, task) => (
        <Space size={6} onClick={(e) => e.stopPropagation()}>
          <Button
            size="small"
            type="link"
            icon={<EyeOutlined />}
            onClick={() => go(`/build?task=${encodeURIComponent(task.task_id)}`)}
          >
            控制台
          </Button>
          {task.status === 'completed' && task.output_iso && (
            <Button
              size="small"
              icon={<DownloadOutlined />}
              aria-label={`下载 ${task.task_id} 产物`}
              onClick={() => window.open(getBuildArtifactUrl(task.task_id), '_blank', 'noopener,noreferrer')}
            />
          )}
        </Space>
      ),
    },
  ]

  const readinessItems = [
    {
      key: 'bucket',
      label: '默认存储挂载节点',
      ready: Boolean(defaultBucket),
      detail: defaultBucket ? `${defaultBucket.name} (${(defaultBucket.type || 's3').toUpperCase()})` : '尚未配置存储节点',
      actionLabel: defaultBucket ? '管理节点' : '立即添加',
      onAction: () => go('/storage?focus=nodes'),
    },
    {
      key: 'depot',
      label: '基础 ESXi ISO / Depot 源',
      ready: stats.depots > 0,
      detail: stats.depots > 0 ? `已就绪 ${stats.depots} 个基础镜像源` : '待上传基础 ISO 或 Depot 补丁包',
      actionLabel: stats.depots > 0 ? '查看文件库' : '去上传',
      onAction: () => go('/storage'),
    },
    {
      key: 'driver',
      label: '社区驱动包 (VIB / ZIP)',
      ready: stats.drivers > 0,
      detail: stats.drivers > 0 ? `已入库 ${stats.drivers} 个网卡/存储驱动` : '可选上传社区驱动用于注入',
      actionLabel: '管理驱动',
      onAction: () => go('/storage'),
    },
  ]

  return (
    <PageContainer
      title="运行总览"
      subTitle="一屏掌控构建引擎态势、存储资产就绪度与最近定制任务"
    >
      <div className="page-stack">
        {/* Hero Command Banner */}
        <section className="overview-hero-banner" aria-label="快速操作横幅">
          <div className="overview-hero-main">
            <div className="overview-hero-icon" aria-hidden="true">
              <CloudServerOutlined />
            </div>
            <div className="overview-hero-copy">
              <Space size={8} wrap align="center">
                <Typography.Title level={4} style={{ margin: 0 }}>
                  ESXi ISO 极速定制中心
                </Typography.Title>
                <Badge status="processing" text="服务在线" />
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                  Linux 原生重封装引擎 · 5~10s
                </Tag>
              </Space>
              <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                从「存储与文件库」准备基础镜像与驱动，进入「构建工作台」即可一键注入驱动、预设无人值守参数并原地查看实时日志与下载产物。
              </Typography.Paragraph>
            </div>
          </div>
          <div className="overview-hero-actions">
            <Button
              size="middle"
              icon={<CloudUploadOutlined />}
              onClick={() => go('/storage')}
            >
              管理存储与文件
            </Button>
            <Button
              type="primary"
              size="middle"
              icon={<RocketOutlined />}
              onClick={() => go('/build')}
            >
              进入构建工作台
            </Button>
          </div>
        </section>

        {/* 4 Modern KPI Cards */}
        <section className="kpi-grid" aria-label="核心运行指标">
          <div className="kpi-card" onClick={() => go('/build')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go('/build')}>
            <div className="kpi-card-top">
              <span className="kpi-card-label">累计构建任务</span>
              <span className="kpi-icon kpi-icon-blue"><ApartmentOutlined /></span>
            </div>
            <div className="kpi-card-value tabular-nums">{stats.total}</div>
            <div className="kpi-card-foot">
              已完成 <strong className="tabular-nums">{stats.completed}</strong> · 失败 <strong className="tabular-nums">{stats.failed}</strong>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-card-top">
              <span className="kpi-card-label">近期构建成功率</span>
              <span className="kpi-icon kpi-icon-green"><CheckCircleOutlined /></span>
            </div>
            <div className="kpi-card-value tabular-nums">{stats.successRate}%</div>
            <div className="kpi-card-foot">
              <Progress percent={stats.successRate} showInfo={false} size="small" strokeColor="#059669" />
            </div>
          </div>

          <div className="kpi-card" onClick={() => go('/build')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go('/build')}>
            <div className="kpi-card-top">
              <span className="kpi-card-label">正在执行任务</span>
              <span className="kpi-icon kpi-icon-amber"><ClockCircleOutlined /></span>
            </div>
            <div className="kpi-card-value tabular-nums">{stats.running}</div>
            <div className="kpi-card-foot">
              {stats.running > 0 ? (
                <Typography.Text type="warning">点击前往构建台查看实时日志</Typography.Text>
              ) : (
                '当前队列空闲，随时可发起极速构建'
              )}
            </div>
          </div>

          <div className="kpi-card" onClick={() => go('/storage')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go('/storage')}>
            <div className="kpi-card-top">
              <span className="kpi-card-label">存储挂载与资产</span>
              <span className="kpi-icon kpi-icon-purple"><DatabaseOutlined /></span>
            </div>
            <div className="kpi-card-value tabular-nums">
              {stats.buckets} <span className="kpi-unit">节点</span>
            </div>
            <div className="kpi-card-foot">
              源镜像 <strong className="tabular-nums">{stats.depots}</strong> · 驱动包 <strong className="tabular-nums">{stats.drivers}</strong>
            </div>
          </div>
        </section>

        {/* Main 2-Column Bento Grid */}
        <div className="overview-bento-grid">
          <ProCard
            title="最近构建动态"
            bordered
            headerBordered
            className="contain-panel"
            extra={
              <Space size={8} wrap>
                <Segmented<StatusFilter>
                  size="small"
                  value={statusFilter}
                  onChange={setStatusFilter}
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
                  loading={buildsQuery.isFetching}
                  onClick={() => buildsQuery.refetch()}
                >
                  刷新
                </Button>
              </Space>
            }
          >
            <Table
              rowKey="task_id"
              size="middle"
              columns={columns}
              dataSource={filteredTasks}
              loading={buildsQuery.isLoading}
              pagination={{ pageSize: 6, showSizeChanger: false }}
              scroll={{ x: 760 }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="暂无匹配的构建记录"
                  >
                    <Button type="primary" size="small" icon={<ToolOutlined />} onClick={() => go('/build')}>
                      创建首个构建任务
                    </Button>
                  </Empty>
                ),
              }}
              onRow={(task) => ({
                style: { cursor: 'pointer' },
                onClick: () => go(`/build?task=${encodeURIComponent(task.task_id)}`),
              })}
            />
          </ProCard>

          <div className="overview-side-stack">
            <ProCard title="构建环境就绪检查" bordered headerBordered className="contain-panel">
              <div className="readiness-list">
                {readinessItems.map((item) => (
                  <div key={item.key} className="readiness-item">
                    <div className="readiness-item-main">
                      <Space size={8}>
                        <Badge status={item.ready ? 'success' : 'warning'} />
                        <Typography.Text strong>{item.label}</Typography.Text>
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {item.detail}
                      </Typography.Text>
                    </div>
                    <Button size="small" type="text" onClick={item.onAction}>
                      {item.actionLabel} <ArrowRightOutlined />
                    </Button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <Button block icon={<FileZipOutlined />} onClick={() => go('/storage')}>
                  上传源 / 驱动
                </Button>
                <Button block type="primary" icon={<RocketOutlined />} onClick={() => go('/build')}>
                  开始定制构建
                </Button>
              </div>
            </ProCard>

            <ProCard title="本机实时资源负载" bordered headerBordered className="contain-panel">
              <div className="runtime-status-stack">
                <RuntimeStatusCard
                  type="cpu"
                  title="CPU 负载"
                  value={formatPercent(systemQuery.data?.cpu.usage_percent)}
                  detail={systemQuery.data ? `${systemQuery.data.cpu.cores} 核心在线` : '采集中...'}
                  percent={systemQuery.data?.cpu.usage_percent ?? 0}
                />
                <RuntimeStatusCard
                  type="memory"
                  title="内存占用"
                  value={formatPercent(systemQuery.data?.memory.usage_percent)}
                  detail={
                    systemQuery.data
                      ? `${formatBytes(systemQuery.data.memory.used_bytes)} / ${formatBytes(systemQuery.data.memory.total_bytes)}`
                      : '采集中...'
                  }
                  percent={systemQuery.data?.memory.usage_percent ?? 0}
                />
                <RuntimeStatusCard
                  type="network"
                  title="网络吞吐"
                  value={
                    systemQuery.data
                      ? `${formatBytes(systemQuery.data.network.rx_bytes_per_sec + systemQuery.data.network.tx_bytes_per_sec)}/s`
                      : '-'
                  }
                  detail={
                    systemQuery.data
                      ? `↓ ${formatBytes(systemQuery.data.network.rx_bytes_per_sec)}/s · ↑ ${formatBytes(systemQuery.data.network.tx_bytes_per_sec)}/s`
                      : '采集中...'
                  }
                  percent={networkPercent(
                    systemQuery.data?.network.rx_bytes_per_sec ?? 0,
                    systemQuery.data?.network.tx_bytes_per_sec ?? 0
                  )}
                />
              </div>
            </ProCard>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}

function RuntimeStatusCard({
  type,
  title,
  value,
  detail,
  percent,
}: {
  type: 'cpu' | 'memory' | 'network'
  title: string
  value: string
  detail: string
  percent: number
}) {
  return (
    <div className={`runtime-status-card runtime-status-card-${type}`}>
      <RuntimeStatusIcon type={type} />
      <div className="runtime-status-content">
        <div className="runtime-status-row">
          <span className="runtime-status-title">{title}</span>
          <span className="runtime-status-value tabular-nums">{value}</span>
        </div>
        <div className="runtime-status-detail tabular-nums">{detail}</div>
        <Progress percent={Math.min(100, Math.max(0, Math.round(percent)))} showInfo={false} size="small" />
      </div>
    </div>
  )
}

function RuntimeStatusIcon({ type }: { type: 'cpu' | 'memory' | 'network' }) {
  if (type === 'cpu') {
    return (
      <svg className="runtime-status-svg" viewBox="0 0 48 48" role="img" aria-label="CPU">
        <rect className="runtime-chip-core" x="13" y="13" width="22" height="22" rx="5" />
        <rect className="runtime-chip-inner" x="18" y="18" width="12" height="12" rx="2" />
        {[10, 18, 26, 34].map((y) => (
          <path key={`l-${y}`} className="runtime-chip-pin" d={`M7 ${y}h6M35 ${y}h6`} />
        ))}
        {[10, 18, 26, 34].map((x) => (
          <path key={`t-${x}`} className="runtime-chip-pin" d={`M${x} 7v6M${x} 35v6`} />
        ))}
      </svg>
    )
  }

  if (type === 'memory') {
    return (
      <svg className="runtime-status-svg" viewBox="0 0 48 48" role="img" aria-label="内存">
        <rect className="runtime-memory-body" x="9" y="16" width="30" height="16" rx="4" />
        <path className="runtime-memory-line" d="M15 22h18M15 27h12" />
        {[13, 19, 25, 31].map((x) => (
          <path key={x} className="runtime-memory-pin" d={`M${x} 32v5`} />
        ))}
      </svg>
    )
  }

  return (
    <svg className="runtime-status-svg" viewBox="0 0 48 48" role="img" aria-label="网络">
      <circle className="runtime-network-node" cx="24" cy="24" r="5" />
      <circle className="runtime-network-dot" cx="12" cy="14" r="3" />
      <circle className="runtime-network-dot" cx="36" cy="14" r="3" />
      <circle className="runtime-network-dot" cx="12" cy="34" r="3" />
      <circle className="runtime-network-dot" cx="36" cy="34" r="3" />
      <path className="runtime-network-line" d="M14.5 15.8 20 20M33.5 15.8 28 20M14.5 32.2 20 28M33.5 32.2 28 28" />
    </svg>
  )
}

function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) return '-'
  return `${value.toFixed(1)}%`
}

function networkPercent(rxBytesPerSec: number, txBytesPerSec: number) {
  const total = rxBytesPerSec + txBytesPerSec
  if (total <= 0) return 0
  return Math.min(100, Math.max(8, Math.round((Math.log10(total + 1) / 8) * 100)))
}
