import {
  ApartmentOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  RocketOutlined,
} from '@ant-design/icons'
import { PageContainer, ProCard, StatisticCard } from '../components/pro-compat'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Progress, Space, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo } from 'react'
import { listBuckets } from '../api/buckets'
import { listBuilds } from '../api/builds'
import { getSystemStatus } from '../api/system'
import type { BuildTask } from '../types'
import { formatBytes, formatDate } from '../utils'
import { BuildStatusTag } from './pageUtils'

export default function OverviewPage() {
  const buildsQuery = useQuery({ queryKey: ['overview-builds'], queryFn: () => listBuilds(1, 20), refetchInterval: 10000 })
  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const systemQuery = useQuery({ queryKey: ['system-status'], queryFn: getSystemStatus, refetchInterval: 3000, retry: false })

  const stats = useMemo(() => {
    const tasks = buildsQuery.data?.items ?? []
    const completed = tasks.filter((task) => task.status === 'completed').length
    const failed = tasks.filter((task) => task.status === 'failed').length
    const running = tasks.filter((task) => task.status === 'running').length
    const totalFinished = completed + failed
    const successRate = totalFinished === 0 ? 0 : Math.round((completed / totalFinished) * 100)

    return {
      total: buildsQuery.data?.total ?? tasks.length,
      completed,
      running,
      successRate,
      buckets: bucketsQuery.data?.length ?? 0,
    }
  }, [buildsQuery.data, bucketsQuery.data])

  const columns: ColumnsType<BuildTask> = [
    {
      title: '任务 ID',
      dataIndex: 'task_id',
      render: (value: string) => (
        <Typography.Text className="mono" copyable>
          {value}
        </Typography.Text>
      ),
    },
    { title: 'ESXi', dataIndex: 'esxi_version', width: 110 },
    { title: '状态', width: 120, render: (_, task) => <BuildStatusTag status={task.status} /> },
    { title: '进度', width: 180, render: (_, task) => <Progress percent={task.progress || 0} size="small" /> },
    { title: '创建时间', dataIndex: 'created_at', width: 190, render: (value: string) => formatDate(value) },
  ]

  return (
    <PageContainer title="总览" subTitle="项目运行参数、仓库入口和最近构建状态">
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <ProCard className="overview-hero-card" bordered>
          <div className="overview-hero">
            <div className="overview-hero-main">
              <div className="overview-hero-icon">
                <CloudServerOutlined />
              </div>
              <div>
                <Typography.Title level={4}>ESXi ISO 构建中心</Typography.Title>
                <Typography.Paragraph type="secondary">
                  统一管理 Depot、驱动、ISO 输出和构建日志，当前页面用于确认根项目部署参数与运行入口。
                </Typography.Paragraph>
              </div>
            </div>
            <div className="overview-hero-actions">
              <Badge status="processing" text="运行中" />
              <Button href="/build" type="primary" icon={<RocketOutlined />}>
                创建构建
              </Button>
            </div>
          </div>
        </ProCard>

        <StatisticCard.Group className="overview-stat-group">
          <StatisticCard statistic={{ title: '构建总数', value: stats.total, icon: <ApartmentOutlined /> }} />
          <StatisticCard statistic={{ title: '成功率', value: `${stats.successRate}%`, icon: <CheckCircleOutlined /> }} />
          <StatisticCard statistic={{ title: '运行任务', value: stats.running, icon: <ClockCircleOutlined /> }} />
          <StatisticCard statistic={{ title: '存储节点', value: stats.buckets, icon: <DatabaseOutlined /> }} />
        </StatisticCard.Group>

        <ProCard title="本机运行状态" bordered headerBordered>
          <div className="runtime-status-grid">
            <RuntimeStatusCard
              type="cpu"
              title="CPU"
              value={formatPercent(systemQuery.data?.cpu.usage_percent)}
              detail={systemQuery.data ? `${systemQuery.data.cpu.cores} 核心` : '等待采集'}
              percent={systemQuery.data?.cpu.usage_percent ?? 0}
            />
            <RuntimeStatusCard
              type="memory"
              title="内存"
              value={formatPercent(systemQuery.data?.memory.usage_percent)}
              detail={systemQuery.data ? `${formatBytes(systemQuery.data.memory.used_bytes)} / ${formatBytes(systemQuery.data.memory.total_bytes)}` : '等待采集'}
              percent={systemQuery.data?.memory.usage_percent ?? 0}
            />
            <RuntimeStatusCard
              type="network"
              title="网络"
              value={systemQuery.data ? `${formatBytes(systemQuery.data.network.rx_bytes_per_sec + systemQuery.data.network.tx_bytes_per_sec)}/s` : '-'}
              detail={systemQuery.data ? `下行 ${formatBytes(systemQuery.data.network.rx_bytes_per_sec)}/s · 上行 ${formatBytes(systemQuery.data.network.tx_bytes_per_sec)}/s` : '等待采集'}
              percent={networkPercent(systemQuery.data?.network.rx_bytes_per_sec ?? 0, systemQuery.data?.network.tx_bytes_per_sec ?? 0)}
            />
          </div>
        </ProCard>

        <ProCard title="最近构建" bordered headerBordered>
          <Table
            rowKey="task_id"
            size="middle"
            columns={columns}
            dataSource={buildsQuery.data?.items ?? []}
            loading={buildsQuery.isLoading}
            pagination={{ pageSize: 6, showSizeChanger: false }}
            scroll={{ x: 820 }}
          />
        </ProCard>
      </Space>
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
        <div className="runtime-status-title">{title}</div>
        <div className="runtime-status-value">{value}</div>
        <div className="runtime-status-detail">{detail}</div>
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
