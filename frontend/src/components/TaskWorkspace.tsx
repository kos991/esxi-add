import { DeleteOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Descriptions, Empty, Popconfirm, Progress, Space, Table, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useRef, useState } from 'react'
import { listBuckets } from '../api/buckets'
import { deleteBuild, getBuild, getBuildArtifactUrl, listBuilds } from '../api/builds'
import { useWebSocket } from '../hooks/useWebSocket'
import { BuildStatusTag } from '../pages/pageUtils'
import type { BuildTask } from '../types'
import { buildPublicObjectUrl, formatDate, parseDrivers } from '../utils'

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
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
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

              {selectedTask.status === 'failed' && selectedTask.error_message && <Alert type="error" showIcon message="构建失败" description={selectedTask.error_message} />}

              {selectedTask.status === 'completed' && selectedTask.output_iso ? (
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
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
