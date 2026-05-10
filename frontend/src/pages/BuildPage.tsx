import { CheckCircleOutlined, CloudDownloadOutlined, FileZipOutlined, PlayCircleOutlined, ToolOutlined } from '@ant-design/icons'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { Alert, Button, Form, Input, Progress, Select, Space, Steps, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { listBuckets } from '../api/buckets'
import { createBuild, getBuildPreflight, startBuildPreflight } from '../api/builds'
import { listDepots, listDrivers } from '../api/files'
import type { FileMetadata } from '../types'
import { assetTitle, cacheStatusColor, cacheStatusText, esxiVersions, fileName } from './pageUtils'

type DepotOption = {
  key: string
  bucketId: number
  bucketName: string
  file: FileMetadata
}

function depotKey(bucketId: number, file: FileMetadata) {
  return `${bucketId}:${file.id}:${file.path}`
}

export default function BuildPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [form] = Form.useForm()
  const [step, setStep] = useState(0)
  const [version, setVersion] = useState('8.0')
  const [bucketId, setBucketId] = useState<number | undefined>()
  const [depotPath, setDepotPath] = useState('')
  const [driverPaths, setDriverPaths] = useState<string[]>([])
  const [preflightId, setPreflightId] = useState<string | null>(null)
  const [preflightKey, setPreflightKey] = useState('')

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
  const driversQuery = useQuery({
    queryKey: ['build-drivers', selectedBucketId, version],
    queryFn: () => listDrivers(selectedBucketId as number, version),
    enabled: Boolean(selectedBucketId),
  })
  const selectedDepot = depotOptions.find((item) => item.bucketId === selectedBucketId && item.file.path === depotPath)
  const selectionKey = JSON.stringify({ bucketId: selectedBucketId, depotPath, driverPaths: [...driverPaths].sort() })

  const startPreflightMutation = useMutation({
    mutationFn: startBuildPreflight,
    onSuccess: (preflight) => {
      setPreflightId(preflight.id)
      messageApi.success('下载校验已启动')
    },
    onError: (error) => messageApi.error(String(error)),
  })
  const preflightQuery = useQuery({
    queryKey: ['build-preflight', preflightId],
    queryFn: () => getBuildPreflight(preflightId as string),
    enabled: Boolean(preflightId),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1200 : false),
  })
  const preflight = preflightQuery.data
  const preflightReady = preflight?.status === 'ready' && preflightKey === selectionKey

  const createMutation = useMutation({
    mutationFn: createBuild,
    onSuccess: (task) => window.location.assign(`/tasks/${task.task_id}`),
    onError: (error) => messageApi.error(String(error)),
  })

  useEffect(() => {
    if (step !== 2 || !selectedBucketId || !depotPath || preflightKey === selectionKey || startPreflightMutation.isPending) return
    setPreflightId(null)
    setPreflightKey(selectionKey)
    startPreflightMutation.mutate({
      bucket_id: selectedBucketId,
      depot_path: depotPath,
      driver_paths: driverPaths,
    })
  }, [depotPath, driverPaths, preflightKey, selectedBucketId, selectionKey, startPreflightMutation, step])

  const resetPreflight = () => {
    setPreflightId(null)
    setPreflightKey('')
  }

  const chooseDepot = (value: string) => {
    const option = depotOptions.find((item) => item.key === value)
    setBucketId(option?.bucketId)
    setDepotPath(option?.file.path ?? '')
    setDriverPaths([])
    resetPreflight()
  }

  const nextStep = async () => {
    if (step === 0 && !depotPath) {
      messageApi.warning('请选择 Depot 源文件')
      return
    }
    if (step === 2 && !preflightReady) {
      messageApi.warning('请等待下载校验完成')
      return
    }
    setStep((value) => Math.min(value + 1, 3))
  }

  const submitBuild = async () => {
    const values = await form.validateFields()
    if (!selectedBucketId || !depotPath) {
      messageApi.warning('请选择存储节点和 Depot 文件')
      setStep(0)
      return
    }
    if (!preflightReady) {
      messageApi.warning('请先完成下载校验')
      setStep(2)
      return
    }
    createMutation.mutate({
      bucket_id: selectedBucketId,
      esxi_version: version,
      depot_path: depotPath,
      driver_paths: driverPaths,
      custom_iso_name: values.custom_iso_name || undefined,
    })
  }

  const items = [
    { title: '选择源文件', icon: <FileZipOutlined /> },
    { title: '驱动注入', icon: <ToolOutlined /> },
    { title: '下载校验', icon: <CloudDownloadOutlined /> },
    { title: '输出设置', icon: <PlayCircleOutlined /> },
  ]

  return (
    <PageContainer title="自定义构建" subTitle="四步导航式 ISO 构建流程，选择项通过下拉框完成">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <ProCard bordered className="wizard-steps-card">
          <Steps type="navigation" current={step} onChange={(next) => next <= step && setStep(next)} items={items} />
        </ProCard>

        <ProCard title={`${step + 1}. ${items[step].title}`} bordered headerBordered className="build-step-card" bodyStyle={{ minHeight: 390 }}>
          {step === 0 && (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Alert type="info" showIcon message="从所有存储节点中选择与 ESXi 版本匹配的 Depot 文件。" />
              <Form layout="vertical">
                <Form.Item label="ESXi 基础版本" required>
                  <Select
                    value={version}
                    onChange={(value) => {
                      setVersion(value)
                      setBucketId(undefined)
                      setDepotPath('')
                      setDriverPaths([])
                      resetPreflight()
                    }}
                    options={esxiVersions.map((item) => ({ value: item, label: `ESXi ${item}` }))}
                    style={{ maxWidth: 320 }}
                  />
                </Form.Item>
                <Form.Item label="Depot 源文件" required>
                  <Select
                    showSearch
                    value={selectedDepot?.key}
                    placeholder="选择 Depot 文件"
                    loading={bucketsQuery.isLoading || depotQueries.some((query) => query.isLoading)}
                    onChange={chooseDepot}
                    optionFilterProp="label"
                    options={depotOptions.map((item) => ({
                      value: item.key,
                      label: `${item.bucketName} / ${fileName(item.file)}`,
                    }))}
                  />
                </Form.Item>
              </Form>
              {selectedDepot && (
                <ProCard ghost bordered={false} className="selected-source-card">
                  <Space wrap>
                    <Tag color="blue">{selectedDepot.bucketName}</Tag>
                    <Tag color={cacheStatusColor(selectedDepot.file, selectedBucket)}>{cacheStatusText(selectedDepot.file, selectedBucket)}</Tag>
                    <Typography.Text className="mono" copyable>
                      {selectedDepot.file.path}
                    </Typography.Text>
                  </Space>
                </ProCard>
              )}
            </Space>
          )}

          {step === 1 && (
            <Form layout="vertical">
              <Form.Item label="选择需要注入的驱动">
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  value={driverPaths}
                  placeholder="可留空，仅使用 Depot 构建"
                  loading={driversQuery.isLoading}
                  onChange={(value) => {
                    setDriverPaths(value)
                    resetPreflight()
                  }}
                  optionFilterProp="label"
                  options={(driversQuery.data ?? []).map((file) => ({
                    value: file.path,
                    label: `${assetTitle(file)} / ${file.path}`,
                  }))}
                />
              </Form.Item>
              <Typography.Paragraph type="secondary">
                当前已选择 {driverPaths.length} 个驱动。驱动清单只通过下拉框选择，不再展示额外表格。
              </Typography.Paragraph>
            </Form>
          )}

          {step === 2 && (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Space>
                <Button
                  icon={<CloudDownloadOutlined />}
                  onClick={() => {
                    if (!selectedBucketId || !depotPath) return
                    setPreflightKey(selectionKey)
                    startPreflightMutation.mutate({
                      bucket_id: selectedBucketId,
                      depot_path: depotPath,
                      driver_paths: driverPaths,
                    })
                  }}
                  loading={startPreflightMutation.isPending || preflight?.status === 'running'}
                >
                  重新校验
                </Button>
                {preflightReady && (
                  <Tag color="success" icon={<CheckCircleOutlined />}>
                    校验通过
                  </Tag>
                )}
              </Space>
              <Progress
                percent={preflight?.progress ?? 0}
                status={preflight?.status === 'failed' || preflight?.status === 'invalid' ? 'exception' : preflightReady ? 'success' : 'active'}
              />
              {(preflight?.files ?? []).map((file) => (
                <ProCard key={`${file.kind}-${file.path}`} size="small" bordered className="preflight-file-card">
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag>{file.kind === 'depot' ? 'Depot' : '驱动'}</Tag>
                      <Tag color={file.status === 'ready' ? 'success' : file.status === 'failed' || file.status === 'invalid' ? 'error' : 'processing'}>
                        {file.status}
                      </Tag>
                      <Typography.Text>{file.progress}%</Typography.Text>
                    </Space>
                    <Typography.Text className="mono" copyable>
                      {file.path}
                    </Typography.Text>
                    {file.message && <Typography.Text type="danger">{file.message}</Typography.Text>}
                  </Space>
                </ProCard>
              ))}
            </Space>
          )}

          {step === 3 && (
            <Form form={form} layout="vertical" initialValues={{ custom_iso_name: '' }}>
              <Form.Item name="custom_iso_name" label="输出镜像名称">
                <Input className="mono" placeholder="custom-esxi.iso" />
              </Form.Item>
              <Alert type="success" showIcon message="配置已完成，可以提交后端创建构建任务。" />
            </Form>
          )}
        </ProCard>

        <ProCard ghost className="build-action-bar">
          <Space>
            {step > 0 && <Button onClick={() => setStep((value) => Math.max(value - 1, 0))}>上一步</Button>}
            {step < 3 ? (
              <Button type="primary" onClick={nextStep}>
                下一步
              </Button>
            ) : (
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={submitBuild} loading={createMutation.isPending} disabled={!preflightReady}>
                开始构建
              </Button>
            )}
          </Space>
        </ProCard>
      </Space>
    </PageContainer>
  )
}
