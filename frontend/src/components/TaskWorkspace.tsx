import { ClockCircleOutlined, DeleteOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { PageContainer, ProCard } from './pro-compat'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Descriptions, Empty, Popconfirm, Progress, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useRef, useState } from 'react'
import { listBuckets } from '../api/buckets'
import { deleteBuild, getBuild, getBuildArtifactUrl, listBuilds } from '../api/builds'
import { useWebSocket } from '../hooks/useWebSocket'
import { BuildStatusTag } from '../pages/pageUtils'
import type { BuildTask } from '../types'
import { buildPublicObjectUrl, formatDate, parseDrivers } from '../utils'

export interface TimingPhaseItem {
  key: string
  label: string
  color: string
  desc: string
  ms: number
  seconds: string
  percent: number
}

export const TIMING_PHASE_DEFS: { key: string; label: string; color: string; desc: string }[] = [
  { key: 'input_prepare_ms', label: '输入准备', color: '#13c2c2', desc: '文件定位与哈希校验' },
  { key: 'powercli_load_ms', label: 'PowerCLI 初始化', color: '#1677ff', desc: 'ImageBuilder 模块加载' },
  { key: 'depot_profile_ms', label: 'Depot & Profile', color: '#722ed1', desc: '加载 Depot 与克隆 Profile' },
  { key: 'driver_injection_ms', label: '驱动注入', color: '#fa8c16', desc: '注入社区驱动包 (VIB/ZIP)' },
  { key: 'iso_export_ms', label: 'ISO 镜像导出', color: '#eb2f96', desc: 'ImageBuilder 打包 ISO9660 镜像' },
  { key: 'artifact_persist_ms', label: '产物持久化', color: '#52c41a', desc: '流式 SHA256 校验与入库持久化' },
]

export function parseTimingMetrics(logs: string[]): Record<string, number> {
  const metrics: Record<string, number> = {}
  for (const line of logs) {
    const match = line.match(/\[TIMING\]\s+([a-zA-Z0-9_]+)=(\d+)/)
    if (match) {
      metrics[match[1]] = parseInt(match[2], 10)
    }
  }
  return metrics
}

export function PhaseTimingBreakdown({
  logs,
  buildDuration,
  isCompleted,
}: {
  logs: string[]
  buildDuration?: number
  isCompleted?: boolean
}) {
  const metrics = useMemo(() => parseTimingMetrics(logs), [logs])

  const phases = useMemo(() => {
    const present: TimingPhaseItem[] = []
    let sumMs = 0

    for (const def of TIMING_PHASE_DEFS) {
      if (typeof metrics[def.key] === 'number') {
        const ms = metrics[def.key]
        sumMs += ms
        present.push({
          key: def.key,
          label: def.label,
          color: def.color,
          desc: def.desc,
          ms,
          seconds: (ms / 1000).toFixed(2),
          percent: 0,
        })
      }
    }

    const baseMs = sumMs > 0 ? sumMs : 1
    for (const p of present) {
      p.percent = Math.min(100, Math.round((p.ms / baseMs) * 1000) / 10)
    }

    return {
      items: present,
      sumMs,
      totalSeconds: (sumMs / 1000).toFixed(2),
      hasMetrics: present.length > 0,
    }
  }, [metrics])

  if (!phases.hasMetrics && !isCompleted) {
    return null
  }

  return (
    <div
      className="phase-timing-card"
      data-testid="phase-timing-card"
      style={{
        background: '#ffffff',
        border: '1px solid #e8e8e8',
        borderRadius: 8,
        padding: '14px 16px',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space size={8} align="center">
          <ClockCircleOutlined style={{ color: '#1677ff', fontSize: 15 }} />
          <Typography.Text strong style={{ fontSize: 14 }}>
            阶段耗时分解
          </Typography.Text>
          {phases.hasMetrics && (
            <Tag color="blue" style={{ borderRadius: 10, padding: '0 8px', fontSize: 11 }}>
              {phases.items.length} 阶段已记录
            </Tag>
          )}
        </Space>
        <Space size={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            阶段累计：
            <Typography.Text strong className="mono" style={{ color: '#1f2329' }}>
              {phases.totalSeconds}s
            </Typography.Text>
          </Typography.Text>
          {typeof buildDuration === 'number' && buildDuration > 0 && (
            <Tag color="cyan" style={{ borderRadius: 10, padding: '0 8px', fontSize: 11 }}>
              任务总耗时：{buildDuration}s
            </Tag>
          )}
        </Space>
      </div>

      {phases.hasMetrics ? (
        <>
          {/* Multi-segment stacked overview progress bar */}
          <div
            style={{
              display: 'flex',
              height: 10,
              borderRadius: 5,
              overflow: 'hidden',
              background: '#f0f2f5',
              marginBottom: 14,
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
            }}
          >
            {phases.items.map((phase) => (
              <Tooltip
                key={phase.key}
                title={`${phase.label} (${phase.desc}): ${phase.seconds}s (${phase.percent}%)`}
              >
                <div
                  style={{
                    width: `${phase.percent}%`,
                    backgroundColor: phase.color,
                    transition: 'width 0.4s ease',
                    minWidth: phase.percent > 0 ? 3 : 0,
                  }}
                />
              </Tooltip>
            ))}
          </div>

          {/* Phase items rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {phases.items.map((phase) => (
              <div
                key={phase.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  fontSize: 12,
                  padding: '2px 0',
                }}
              >
                <div style={{ width: 140, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: phase.color,
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  <Typography.Text style={{ fontSize: 12, fontWeight: 500 }}>
                    {phase.label}
                  </Typography.Text>
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <Progress
                    percent={phase.percent}
                    strokeColor={phase.color}
                    size="small"
                    showInfo={false}
                    trailColor="#f0f2f5"
                  />
                </div>
                <div style={{ width: 75, textAlign: 'right', flexShrink: 0 }}>
                  <Typography.Text className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                    {phase.seconds}s
                  </Typography.Text>
                </div>
                <div style={{ width: 55, textAlign: 'right', flexShrink: 0 }}>
                  <Typography.Text type="secondary" className="mono" style={{ fontSize: 11 }}>
                    {phase.percent}%
                  </Typography.Text>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          该任务未记录阶段细分耗时指标（构建总耗时：{buildDuration ?? 0} 秒）
        </Typography.Text>
      )}
    </div>
  )
}

function LogLine({ line }: { line: string }) {
  const lower = line.toLowerCase()
  const className = lower.includes('error') || lower.includes('failed') ? 'log-line error' : lower.includes('warn') ? 'log-line warn' : 'log-line'
  return <div className={className}>{line}</div>
}

export function TaskWorkspace({ initialTaskId }: { initialTaskId?: string }) {
  const queryClient = useQueryClient()
  const [messageApi, contextHolder] = message.useMessage()
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(initialTaskId)
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setSelectedTaskId(initialTaskId)
  }, [initialTaskId])

  const tasksQuery = useQuery({
    queryKey: ['builds', 1, 30],
    queryFn: () => listBuilds(1, 30),
    refetchInterval: (query) => ((query.state.data?.items ?? []).some((task) => task.status === 'running') ? 5000 : false),
  })
  const tasks = tasksQuery.data?.items ?? []

  useEffect(() => {
    if (!initialTaskId && !selectedTaskId && tasks[0]?.task_id) {
      setSelectedTaskId(tasks[0].task_id)
    }
  }, [initialTaskId, selectedTaskId, tasks])

  const selectedTaskQuery = useQuery({
    queryKey: ['build', selectedTaskId],
    queryFn: () => getBuild(selectedTaskId as string),
    enabled: Boolean(selectedTaskId),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 5000 : false),
  })
  const selectedTask = selectedTaskQuery.data ?? tasks.find((task) => task.task_id === selectedTaskId)
  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const bucket = useMemo(
    () => bucketsQuery.data?.find((item) => item.id === selectedTask?.storage_bucket_id),
    [bucketsQuery.data, selectedTask?.storage_bucket_id]
  )
  const { logs: wsLogs, progress } = useWebSocket(selectedTaskId ?? null)

  const logs = useMemo(() => {
    if (wsLogs.length > 0) return wsLogs
    return selectedTask?.log_output?.split('\n').filter(Boolean) ?? []
  }, [selectedTask?.log_output, wsLogs])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs, selectedTaskId])

  const deleteMutation = useMutation({
    mutationFn: deleteBuild,
    onSuccess: async (_, taskId) => {
      messageApi.success('任务已删除')
      if (selectedTaskId === taskId) setSelectedTaskId(undefined)
      await queryClient.invalidateQueries({ queryKey: ['builds'] })
      await queryClient.invalidateQueries({ queryKey: ['overview-builds'] })
    },
    onError: (error) => messageApi.error(String(error)),
  })

  const downloadArtifact = (task: BuildTask) => {
    if (task.status !== 'completed' || !task.output_iso) return
    window.open(getBuildArtifactUrl(task.task_id), '_blank', 'noopener,noreferrer')
  }

  const remoteArtifactUrl =
    selectedTask?.output_iso && bucket?.public_domain ? buildPublicObjectUrl(bucket.public_domain, selectedTask.output_iso) : undefined

  const columns: ColumnsType<BuildTask> = [
    {
      title: '任务 ID',
      dataIndex: 'task_id',
      width: 260,
      render: (value: string) => (
        <Typography.Text className="mono table-path" copyable>
          {value}
        </Typography.Text>
      ),
    },
    { title: '状态', width: 110, render: (_, task) => <BuildStatusTag status={task.status} /> },
    { title: 'ESXi', dataIndex: 'esxi_version', width: 92 },
    { title: '进度', width: 170, render: (_, task) => <Progress percent={task.progress || 0} size="small" /> },
    { title: '创建时间', dataIndex: 'created_at', width: 170, render: (value: string) => formatDate(value) },
  ]

  return (
    <PageContainer
      title="任务与日志"
      subTitle="查看构建历史、任务详情和实时输出"
      extra={[
        <Button key="refresh" icon={<ReloadOutlined />} onClick={() => tasksQuery.refetch()} loading={tasksQuery.isFetching}>
          刷新
        </Button>,
      ]}
    >
      {contextHolder}
      <div className="tasks-layout">
        <ProCard title="任务列表" bordered headerBordered className="task-list-card">
          <Table
            rowKey="task_id"
            size="middle"
            columns={columns}
            dataSource={tasks}
            loading={tasksQuery.isLoading}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            scroll={{ x: 820 }}
            rowClassName={(task) => (task.task_id === selectedTaskId ? 'ant-table-row-selected' : '')}
            onRow={(task) => ({
              onClick: () => setSelectedTaskId(task.task_id),
            })}
          />
        </ProCard>

        <ProCard
          title="详情 / 实时日志"
          bordered
          headerBordered
          className="task-log-card"
          extra={
            selectedTask ? (
              <Space>
                <BuildStatusTag status={selectedTask.status} />
                {selectedTask.status === 'completed' && selectedTask.output_iso && (
                  <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadArtifact(selectedTask)}>
                    下载
                  </Button>
                )}
                <Popconfirm title={`删除任务 ${selectedTask.task_id}？`} okText="删除" cancelText="取消" onConfirm={() => deleteMutation.mutate(selectedTask.task_id)}>
                  <Button danger size="small" icon={<DeleteOutlined />} loading={deleteMutation.isPending}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ) : null
          }
        >
          {selectedTask ? (
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              <Descriptions column={2} size="small" bordered className="task-info-list">
                <Descriptions.Item label="任务 ID" span={2}>
                  <Typography.Text className="mono table-path" copyable>
                    {selectedTask.task_id}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="ESXi">{selectedTask.esxi_version}</Descriptions.Item>
                <Descriptions.Item label="进度">{progress || selectedTask.progress || 0}%</Descriptions.Item>
                <Descriptions.Item label="存储">{bucket?.name ?? selectedTask.storage_bucket_id}</Descriptions.Item>
                <Descriptions.Item label="驱动">{parseDrivers(selectedTask.drivers).length}</Descriptions.Item>
                <Descriptions.Item label="创建">{formatDate(selectedTask.created_at)}</Descriptions.Item>
                <Descriptions.Item label="完成">{formatDate(selectedTask.completed_at)}</Descriptions.Item>
                <Descriptions.Item label="Depot" span={2}>
                  <Typography.Text className="mono table-path" copyable>
                    {selectedTask.depot_path}
                  </Typography.Text>
                </Descriptions.Item>
              </Descriptions>

              {selectedTask.status === 'failed' && selectedTask.error_message && <Alert type="error" showIcon title="构建失败" description={selectedTask.error_message} />}

              {selectedTask.status === 'completed' && selectedTask.output_iso ? (
                <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                  <Space wrap>
                    <Button icon={<DownloadOutlined />} onClick={() => downloadArtifact(selectedTask)}>
                      本地下载
                    </Button>
                    {remoteArtifactUrl && (
                      <Button href={remoteArtifactUrl} target="_blank" rel="noreferrer" type="primary" icon={<DownloadOutlined />}>
                        公网链接
                      </Button>
                    )}
                  </Space>
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    <Typography.Text type="secondary">输出：</Typography.Text> <Typography.Text className="mono table-path">{selectedTask.output_iso}</Typography.Text>
                  </Typography.Paragraph>
                  {selectedTask.output_iso_sha256 && (
                    <Typography.Paragraph style={{ marginBottom: 0 }}>
                      <Typography.Text type="secondary">SHA256：</Typography.Text>{' '}
                      <Typography.Text className="mono table-path" copyable>
                        {selectedTask.output_iso_sha256}
                      </Typography.Text>
                    </Typography.Paragraph>
                  )}
                </Space>
              ) : null}

              <PhaseTimingBreakdown
                logs={logs}
                buildDuration={selectedTask.build_duration}
                isCompleted={selectedTask.status === 'completed'}
              />

              <div ref={logRef} className="log-console">
                {logs.length > 0 ? logs.map((line, index) => <LogLine key={`${index}-${line}`} line={line} />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="等待日志输出" />}
              </div>
            </Space>
          ) : (
            <Empty description="请选择任务查看日志" />
          )}
        </ProCard>
      </div>
    </PageContainer>
  )
}
