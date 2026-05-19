import { CheckCircleOutlined, CloudDownloadOutlined, FileZipOutlined, PlayCircleOutlined, SearchOutlined, ToolOutlined } from '@ant-design/icons'
import { PageContainer } from '../components/pro-compat'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Descriptions, Flex, Form, Input, Progress, Select, Space, Steps, Table, Tag, Tooltip, Typography, Watermark, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useState } from 'react'
import { listBuckets } from '../api/buckets'
import { createBuild, getBuildPreflight, startBuildPreflight } from '../api/builds'
import { listDepots, listDrivers } from '../api/files'
import type { FileMetadata } from '../types'
import { assetTitle, cacheStatusColor, cacheStatusText, compactSize, esxiVersions, fileName } from './pageUtils'

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
  const [messageApi, contextHolder] = message.useMessage()
  const [form] = Form.useForm()
  const [step, setStep] = useState(0)
  const [version, setVersion] = useState('8.0')
  const [bucketId, setBucketId] = useState<number | undefined>()
  const [depotPath, setDepotPath] = useState('')
  const [driverPaths, setDriverPaths] = useState<string[]>([])
  const [driverSearch, setDriverSearch] = useState('')
  const [compatibilityFilter, setCompatibilityFilter] = useState<'all' | 'match' | 'attention'>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'local' | 'remote'>('all')
  const [imageProfile, setImageProfile] = useState('')
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
  const drivers = driversQuery.data ?? []
  const selectedDrivers = drivers.filter((file) => driverPaths.includes(file.path))
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
  const imageProfiles = preflight?.image_profiles ?? []

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

  useEffect(() => {
    if (!preflightReady || imageProfiles.length === 0) return
    if (imageProfile && imageProfiles.some((profile) => profile.name === imageProfile)) return
    setImageProfile(preflight?.selected_image_profile || imageProfiles[0].name)
  }, [imageProfile, imageProfiles, preflight?.selected_image_profile, preflightReady])

  const resetPreflight = () => {
    setPreflightId(null)
    setPreflightKey('')
  }

  const chooseDepot = (value: string) => {
    const option = depotOptions.find((item) => item.key === value)
    setBucketId(option?.bucketId)
    setDepotPath(option?.file.path ?? '')
    setDriverPaths([])
    setImageProfile('')
    resetPreflight()
  }

  useEffect(() => {
    if (depotPath || depotOptions.length === 0) return
    const firstDepot = depotOptions[0]
    setBucketId(firstDepot.bucketId)
    setDepotPath(firstDepot.file.path)
  }, [depotOptions, depotPath])

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
      image_profile: imageProfile || undefined,
    })
  }

  const stepItems = [
    { title: '选择源文件', content: depotPath ? 'Depot 已匹配版本' : '选择 Depot 文件', icon: <FileZipOutlined /> },
    { title: '选择驱动', content: '筛选并确认注入列表', icon: <ToolOutlined /> },
    { title: '预检校验', content: '依赖、缓存、空间检查', icon: <CloudDownloadOutlined /> },
    { title: '构建输出', content: '生成 ISO 并归档', icon: <PlayCircleOutlined /> },
  ]
  const preflightStatusText =
    preflightReady ? '已通过' : preflight?.status === 'running' ? '校验中' : preflight?.status ? preflight.status : '未开始'

  const driverIsAttention = (file: FileMetadata) => Boolean(file.conflicts_with || file.depends_on || file.cache_status === 'missing')
  const driverSource = (file: FileMetadata) => (file.cached || selectedBucket?.type === 'local' ? 'local' : 'remote')
  const filteredDrivers = drivers.filter((file) => {
    const keyword = driverSearch.trim().toLowerCase()
    const text = [assetTitle(file), file.path, file.driver_description, file.driver_version].filter(Boolean).join(' ').toLowerCase()
    if (keyword && !text.includes(keyword)) return false
    if (compatibilityFilter === 'match' && driverIsAttention(file)) return false
    if (compatibilityFilter === 'attention' && !driverIsAttention(file)) return false
    if (sourceFilter !== 'all' && driverSource(file) !== sourceFilter) return false
    return true
  })

  const driverColumns: ColumnsType<FileMetadata> = [
    {
      title: '驱动',
      dataIndex: 'path',
      render: (_, file) => (
        <div className="driver-cell">
          <EllipsisText className="driver-title" value={file.driver_name || fileName(file)} strong />
          <EllipsisText className="driver-description" value={file.driver_description || file.path} type="secondary" />
        </div>
      ),
    },
    {
      title: '版本',
      width: 190,
      render: (_, file) => <EllipsisText className="driver-version" value={file.driver_version || '-'} />,
    },
    {
      title: '来源',
      width: 96,
      render: (_, file) => (driverSource(file) === 'local' ? 'Local' : 'Remote'),
    },
    {
      title: '兼容性',
      width: 112,
      render: (_, file) =>
        driverIsAttention(file) ? (
          <Tag color="warning">需确认</Tag>
        ) : (
          <Tag color="success">匹配</Tag>
        ),
    },
    {
      title: '大小',
      width: 92,
      render: (_, file) => compactSize(file.size),
    },
    {
      title: '状态',
      width: 112,
      render: (_, file) => (driverPaths.includes(file.path) ? <Tag color="processing">待注入</Tag> : <Tag color="default">未选择</Tag>),
    },
    {
      title: '操作',
      width: 112,
      render: (_, file) => (
        <Space size={10}>
          <Typography.Link>查看</Typography.Link>
          <Typography.Link
            onClick={() => {
              setDriverPaths((current) => (current.includes(file.path) ? current.filter((path) => path !== file.path) : [...current, file.path]))
              resetPreflight()
            }}
          >
            {driverPaths.includes(file.path) ? '排除' : '注入'}
          </Typography.Link>
        </Space>
      ),
    },
  ]

  const goToStep = (targetStep: number) => {
    if (targetStep !== step) {
      messageApi.info('请使用上一步或继续按钮按顺序完成流程')
    }
  }

  const renderStepContent = () => {
    if (step === 0) {
      return (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Alert type="info" showIcon title="从存储节点中选择与 ESXi 版本匹配的 Depot 文件。" />
          <Form layout="vertical">
            <Form.Item label="ESXi 基础版本" required>
              <Select
                value={version}
                onChange={(value) => {
                  setVersion(value)
                  setBucketId(undefined)
                  setDepotPath('')
                  setDriverPaths([])
                  setImageProfile('')
                  resetPreflight()
                }}
                options={esxiVersions.map((item) => ({ value: item, label: `ESXi ${item}` }))}
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
            <div className="selected-source-strip">
              <Tag color="blue">{selectedDepot.bucketName}</Tag>
              <Tag color={cacheStatusColor(selectedDepot.file, selectedBucket)}>{cacheStatusText(selectedDepot.file, selectedBucket)}</Tag>
              <EllipsisText className="mono selected-source-path" value={selectedDepot.file.path} copyable />
            </div>
          )}
        </Space>
      )
    }

    if (step === 1) {
      return (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <Flex wrap="wrap" gap={12} align="center" justify="space-between">
            <Space wrap>
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder="搜索驱动名称 / 供应商 / 文件名"
                style={{ width: 320 }}
                value={driverSearch}
                onChange={(event) => setDriverSearch(event.target.value)}
              />
              <Select
                value={compatibilityFilter}
                style={{ width: 140 }}
                onChange={setCompatibilityFilter}
                options={[
                  { value: 'all', label: '兼容性 全部' },
                  { value: 'match', label: '仅匹配' },
                  { value: 'attention', label: '需确认' },
                ]}
              />
              <Select
                value={sourceFilter}
                style={{ width: 120 }}
                onChange={setSourceFilter}
                options={[
                  { value: 'all', label: '来源 全部' },
                  { value: 'local', label: '本地' },
                  { value: 'remote', label: '远程' },
                ]}
              />
            </Space>
            <Space>
              <Typography.Text type="secondary">已选 {driverPaths.length} 个</Typography.Text>
              <Button
                onClick={() => {
                  setDriverPaths(filteredDrivers.map((file) => file.path))
                  resetPreflight()
                }}
              >
                全选当前
              </Button>
              <Button
                disabled={driverPaths.length === 0}
                onClick={() => {
                  setDriverPaths([])
                  resetPreflight()
                }}
              >
                清空选择
              </Button>
            </Space>
          </Flex>
          <Table
            className="build-driver-table"
            rowKey="path"
            size="middle"
            tableLayout="fixed"
            loading={driversQuery.isLoading}
            columns={driverColumns}
            dataSource={filteredDrivers}
            pagination={false}
            rowSelection={{
              selectedRowKeys: driverPaths,
              onChange: (keys) => {
                setDriverPaths(keys.map(String))
                resetPreflight()
              },
            }}
          />
        </Space>
      )
    }

    if (step === 2) {
      return (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
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
          <div className="preflight-list">
            {(preflight?.files ?? []).map((file) => (
              <div className="preflight-row" key={`${file.kind}-${file.path}`}>
                <div className="preflight-row-main">
                  <Space wrap size={8}>
                    <Tag>{file.kind === 'depot' ? 'Depot' : '驱动'}</Tag>
                    <Tag color={file.status === 'ready' ? 'success' : file.status === 'failed' || file.status === 'invalid' ? 'error' : 'processing'}>{file.status}</Tag>
                    <Typography.Text>{file.progress}%</Typography.Text>
                  </Space>
                  <EllipsisText className="mono preflight-path" value={file.path} copyable />
                  {file.message && <EllipsisText className="preflight-message" value={file.message} type="danger" />}
                </div>
              </div>
            ))}
          </div>
        </Space>
      )
    }

    return (
      <Form form={form} layout="vertical" initialValues={{ custom_iso_name: '' }}>
        <Form.Item label="Image Profile">
          <Select
            className="build-image-profile-select"
            value={imageProfile || undefined}
            placeholder={imageProfiles.length > 0 ? '选择 Image Profile' : '未解析到 Image Profile，将由构建脚本自动选择'}
            disabled={imageProfiles.length === 0}
            onChange={setImageProfile}
            options={imageProfiles.map((profile) => ({
              value: profile.name,
              label: `${profile.name}${profile.vendor ? ` / ${profile.vendor}` : ''}${profile.acceptance_level ? ` / ${profile.acceptance_level}` : ''}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="custom_iso_name" label="输出镜像名称">
          <Input className="mono" placeholder="custom-esxi.iso" />
        </Form.Item>
        <Alert type="success" showIcon title="配置已完成，可以提交后端创建构建任务。" />
      </Form>
    )
  }

  return (
    <PageContainer title="构建自定义 ESXi ISO" subTitle="步骤驱动工作流：每一步只处理当前需要完成的动作。">
      {contextHolder}
      <Watermark
        className="build-watermark"
        content={['ESXi Builder', 'Build Console']}
        font={{ color: 'rgba(15, 23, 42, 0.045)', fontSize: 15, fontWeight: 500 }}
        gap={[180, 120]}
        rotate={-18}
      >
        <div className="build-workbench">
          <div className="build-main">
            <Card className="build-step-nav-card">
              <Steps className="build-navigation-steps" type="navigation" current={step} items={stepItems} onChange={goToStep} />
            </Card>

            <Card
              className="build-stage-card"
              title={
                <Space orientation="vertical" size={0}>
                  <Typography.Text strong>{stepItems[step].title === '选择驱动' ? '驱动选择' : stepItems[step].title}</Typography.Text>
                  <Typography.Text type="secondary">{stepItems[step].content}</Typography.Text>
                </Space>
              }
              extra={
                step === 1 ? (
                  <Tooltip title="批量导入功能待接入，当前可先使用全选或逐项注入">
                    <Button disabled>批量导入</Button>
                  </Tooltip>
                ) : undefined
              }
              variant="outlined"
            >
              {renderStepContent()}
            </Card>

            <Card className="build-actions-card" size="small">
              <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
                <Typography.Text type="secondary">已选择 {driverPaths.length} 个驱动，预检前仍可返回修改。</Typography.Text>
                <Space>
                  {step > 0 && <Button onClick={() => setStep((value) => Math.max(value - 1, 0))}>上一步</Button>}
                  {step < 3 ? (
                    <Button type="primary" onClick={nextStep}>
                      继续{step === 1 ? '预检' : '下一步'}
                    </Button>
                  ) : (
                    <Button type="primary" icon={<PlayCircleOutlined />} onClick={submitBuild} loading={createMutation.isPending} disabled={!preflightReady}>
                      开始构建
                    </Button>
                  )}
                </Space>
              </Flex>
            </Card>
          </div>

          <Card className="build-summary-card" title="当前配置" variant="outlined">
            <Descriptions
              column={1}
              size="small"
              items={[
                { key: 'version', label: 'ESXi', children: <Typography.Text strong>{version}</Typography.Text> },
                { key: 'bucket', label: '存储节点', children: <Typography.Text strong>{selectedBucket?.name ?? '未选择'}</Typography.Text> },
                {
                  key: 'depot',
                  label: 'Depot',
                  children: (
                    <Typography.Text className="mono" ellipsis>
                      {depotPath || '未选择'}
                    </Typography.Text>
                  ),
                },
                {
                  key: 'drivers',
                  label: '驱动',
                  children: (
                    <Typography.Text strong>
                      {selectedDrivers.length} 个，{compactSize(selectedDrivers.reduce((total, file) => total + (file.size ?? 0), 0))}
                    </Typography.Text>
                  ),
                },
                {
                  key: 'profile',
                  label: 'Profile',
                  children: (
                    <Typography.Text className="mono" ellipsis>
                      {imageProfile || '自动选择'}
                    </Typography.Text>
                  ),
                },
                {
                  key: 'preflight',
                  label: '预检',
                  children: <Tag color={preflightReady ? 'success' : preflight?.status === 'running' ? 'processing' : 'default'}>{preflightStatusText}</Tag>,
                },
              ]}
            />
          </Card>
        </div>
      </Watermark>
    </PageContainer>
  )
}
