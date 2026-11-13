import {
  CloudOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  HddOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { PageContainer, ProCard, StatisticCard } from '../components/pro-compat'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { UploadFile } from 'antd/es/upload/interface'
import { useMemo, useState } from 'react'
import {
  type BucketPayload,
  createBucket,
  deleteBucket,
  listBuckets,
  setDefaultBucket,
  testBucketConnection,
  updateBucket,
} from '../api/buckets'
import {
  deleteFile,
  listDepots,
  listDrivers,
  listISOs,
  refreshFiles,
  renameFile,
  uploadFile,
} from '../api/files'
import type { FileMetadata, StorageBucket } from '../types'
import { buildPublicObjectUrl, formatDate } from '../utils'
import {
  assetTitle,
  assetTypeText,
  bucketLocation,
  bucketType,
  cacheStatusColor,
  cacheStatusText,
  compactSize,
  esxiVersions,
} from './pageUtils'

type UploadType = 'depot' | 'driver' | 'iso'

const defaultBucketPayload: BucketPayload = {
  name: '',
  type: 's3',
  endpoint: '',
  access_key: '',
  secret_key: '',
  bucket_name: '',
  region: '',
  use_ssl: true,
  public_domain: '',
  local_path: '',
  is_default: false,
}

const categories = [
  { value: 'network', label: 'Network' },
  { value: 'storage', label: 'Storage' },
  { value: 'raid', label: 'RAID' },
  { value: 'other', label: 'Other' },
]

export default function StorageFilesPage({ initialTab = 'files' }: { initialTab?: 'files' | 'buckets' }) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'files' | 'buckets'>(initialTab)
  const [messageApi, contextHolder] = message.useMessage()

  // Storage Nodes (Buckets) State
  const [bucketForm] = Form.useForm<BucketPayload>()
  const [bucketModalOpen, setBucketModalOpen] = useState(false)
  const [editingBucket, setEditingBucket] = useState<StorageBucket | null>(null)
  const [storageType, setStorageType] = useState<'s3' | 'local'>('s3')

  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const sortedBuckets = useMemo(
    () => [...(bucketsQuery.data ?? [])].sort((a, b) => Number(b.is_default) - Number(a.is_default)),
    [bucketsQuery.data]
  )
  const defaultBucket = sortedBuckets.find((bucket) => bucket.is_default)

  // File Repository State
  const [bucketId, setBucketId] = useState<number | undefined>()
  const [version, setVersion] = useState('8.0')
  const [category, setCategory] = useState('network')
  const [uploadType, setUploadType] = useState<UploadType>('depot')
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [renaming, setRenaming] = useState<FileMetadata | null>(null)
  const [renameForm] = Form.useForm<{ new_name: string }>()

  const selectedBucketId = useMemo(
    () => bucketId ?? bucketsQuery.data?.find((b) => b.is_default)?.id ?? bucketsQuery.data?.[0]?.id,
    [bucketId, bucketsQuery.data]
  )
  const selectedBucket = useMemo(
    () => bucketsQuery.data?.find((b) => b.id === selectedBucketId),
    [bucketsQuery.data, selectedBucketId]
  )

  const depotsQuery = useQuery({
    queryKey: ['depots', selectedBucketId],
    queryFn: () => listDepots(selectedBucketId as number),
    enabled: Boolean(selectedBucketId),
  })
  const allDriversQuery = useQuery({
    queryKey: ['drivers', selectedBucketId, 'all'],
    queryFn: () => listDrivers(selectedBucketId as number),
    enabled: Boolean(selectedBucketId),
  })
  const driversQuery = useQuery({
    queryKey: ['drivers', selectedBucketId, version, category],
    queryFn: () => listDrivers(selectedBucketId as number, version, category),
    enabled: Boolean(selectedBucketId),
  })
  const isoQuery = useQuery({
    queryKey: ['isos', selectedBucketId],
    queryFn: () => listISOs(selectedBucketId as number),
    enabled: Boolean(selectedBucketId),
  })

  const invalidateFiles = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['depots', selectedBucketId] }),
      queryClient.invalidateQueries({ queryKey: ['drivers', selectedBucketId] }),
      queryClient.invalidateQueries({ queryKey: ['isos', selectedBucketId] }),
      queryClient.invalidateQueries({ queryKey: ['build-depots'] }),
      queryClient.invalidateQueries({ queryKey: ['build-drivers'] }),
    ])
  }

  const invalidateBuckets = async () => {
    await queryClient.invalidateQueries({ queryKey: ['buckets'] })
  }

  const closeBucketModal = () => {
    setBucketModalOpen(false)
    setEditingBucket(null)
    setStorageType('s3')
    bucketForm.resetFields()
  }

  const saveBucketMutation = useMutation({
    mutationFn: (payload: BucketPayload) => {
      const normalized: BucketPayload =
        payload.type === 'local'
          ? {
              name: payload.name?.trim(),
              type: 'local',
              local_path: payload.local_path?.trim(),
              is_default: payload.is_default,
              use_ssl: true,
            }
          : {
              ...payload,
              name: payload.name?.trim(),
              type: 's3',
              endpoint: payload.endpoint?.trim(),
              access_key: payload.access_key?.trim(),
              secret_key: payload.secret_key ? payload.secret_key.trim() : undefined,
              bucket_name: payload.bucket_name?.trim(),
              region: payload.region?.trim(),
              public_domain: payload.public_domain?.trim(),
            }

      return editingBucket ? updateBucket(editingBucket.id, normalized) : createBucket(normalized)
    },
    onSuccess: async () => {
      messageApi.success(editingBucket ? '存储节点已更新' : '存储节点已创建')
      closeBucketModal()
      await invalidateBuckets()
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const deleteBucketMutation = useMutation({
    mutationFn: deleteBucket,
    onSuccess: async () => {
      messageApi.success('存储节点已删除')
      await invalidateBuckets()
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const setDefaultMutation = useMutation({
    mutationFn: setDefaultBucket,
    onSuccess: async () => {
      messageApi.success('已设置为默认存储节点')
      await invalidateBuckets()
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const testConnectionMutation = useMutation({
    mutationFn: testBucketConnection,
    onSuccess: (res) => {
      if (res.connected) {
        messageApi.success('连接测试成功')
      } else {
        messageApi.error('连接测试失败')
      }
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const openCreateBucket = () => {
    setEditingBucket(null)
    setStorageType('s3')
    bucketForm.setFieldsValue(defaultBucketPayload)
    setBucketModalOpen(true)
  }

  const openEditBucket = (bucket: StorageBucket) => {
    setEditingBucket(bucket)
    setStorageType(bucket.type === 'local' ? 'local' : 's3')
    bucketForm.setFieldsValue({
      name: bucket.name,
      type: bucket.type,
      endpoint: bucket.endpoint,
      access_key: bucket.access_key,
      secret_key: '',
      bucket_name: bucket.bucket_name,
      region: bucket.region,
      use_ssl: bucket.use_ssl,
      public_domain: bucket.public_domain,
      local_path: bucket.local_path,
      is_default: bucket.is_default,
    })
    setBucketModalOpen(true)
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBucketId || fileList.length === 0) return
      const file = fileList[0].originFileObj as File
      return uploadFile(
        selectedBucketId,
        uploadType,
        file,
        uploadType === 'iso' ? undefined : version,
        uploadType === 'driver' ? category : undefined
      )
    },
    onSuccess: async () => {
      messageApi.success('文件上传成功')
      setFileList([])
      await invalidateFiles()
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const deleteFileMutation = useMutation({
    mutationFn: deleteFile,
    onSuccess: async () => {
      messageApi.success('文件已删除')
      await invalidateFiles()
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const renameMutation = useMutation({
    mutationFn: ({ fileId, newName }: { fileId: number; newName: string }) =>
      renameFile(fileId, newName),
    onSuccess: async () => {
      messageApi.success('重命名成功')
      setRenaming(null)
      renameForm.resetFields()
      await invalidateFiles()
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const refreshMutation = useMutation({
    mutationFn: () => refreshFiles(selectedBucketId as number),
    onSuccess: async () => {
      messageApi.success('文件元数据已刷新')
      await invalidateFiles()
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const bucketColumns: ColumnsType<StorageBucket> = [
    {
      title: '存储节点名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, b: StorageBucket) => (
        <Space>
          <Typography.Text strong>{text}</Typography.Text>
          {b.is_default && <Tag color="success">默认</Tag>}
          {selectedBucketId === b.id && <Tag color="processing">当前使用中</Tag>}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (_, b) => (
        <Tag color={bucketType(b) === 'local' ? 'purple' : 'blue'}>
          {bucketType(b).toUpperCase()}
        </Tag>
      ),
    },
    {
      title: '路径 / 端点',
      key: 'location',
      render: (_, b) => (
        <Typography.Text className="mono table-path" copyable ellipsis style={{ maxWidth: 320 }}>
          {bucketLocation(b)}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 320,
      render: (_, b) => (
        <Space wrap size={6}>
          <Button
            size="small"
            type={selectedBucketId === b.id ? 'primary' : 'default'}
            icon={<FolderOpenOutlined />}
            onClick={() => {
              setBucketId(b.id)
              setActiveTab('files')
              messageApi.info(`已切换至存储节点：${b.name}`)
            }}
          >
            浏览文件
          </Button>
          {!b.is_default && (
            <Button size="small" onClick={() => setDefaultMutation.mutate(b.id)}>
              设为默认
            </Button>
          )}
          <Button
            size="small"
            onClick={() => testConnectionMutation.mutate(b.id)}
            loading={testConnectionMutation.isPending}
          >
            测试连接
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditBucket(b)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除存储节点？"
            description="删除存储节点不会直接删除远端真实数据，但会从系统移除挂载。"
            onConfirm={() => deleteBucketMutation.mutate(b.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const fileColumns = (type: UploadType): ColumnsType<FileMetadata> => [
    {
      title: '文件名',
      key: 'path',
      render: (_, file) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{assetTitle(file)}</Typography.Text>
          <Typography.Text className="mono table-path" type="secondary" copyable ellipsis style={{ maxWidth: 360 }}>
            {file.path}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'ESXi 版本',
      dataIndex: 'esxi_version',
      width: 100,
      render: (value: string | undefined) => (value ? <Tag color="geekblue">{value}</Tag> : <Tag>通用</Tag>),
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 100,
      render: (value: number | undefined) => compactSize(value),
    },
    {
      title: '状态 / 缓存',
      key: 'status',
      width: 130,
      render: (_, file) => (
        <Tag color={cacheStatusColor(file, selectedBucket)}>
          {cacheStatusText(file, selectedBucket)}
        </Tag>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 170,
      render: (value: string | undefined) => formatDate(value || ''),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, file) => (
        <Space wrap size={4}>
          {selectedBucket?.public_domain && (
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => {
                const url = buildPublicObjectUrl(selectedBucket.public_domain, file.path || '')
                if (url) {
                  navigator.clipboard.writeText(url)
                }
                messageApi.success('已复制公网直链')
              }}
            >
              链接
            </Button>
          )}
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setRenaming(file)
              renameForm.setFieldsValue({ new_name: assetTitle(file) })
            }}
          >
            重命名
          </Button>
          <Popconfirm
            title="确认从文件库中删除该文件？"
            onConfirm={() => deleteFileMutation.mutate(file.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const allAssets = useMemo(() => {
    return [
      ...(depotsQuery.data ?? []),
      ...(allDriversQuery.data ?? []),
      ...(isoQuery.data ?? []),
    ]
  }, [depotsQuery.data, allDriversQuery.data, isoQuery.data])

  return (
    <PageContainer
      title="存储挂载与文件库"
      subTitle="一体化存储工作台：管理本地与 S3 存储挂载节点，统一检索、上传与维护 ISO、Depot 补丁与驱动。"
    >
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <StatisticCard.Group>
          <StatisticCard
            statistic={{
              title: '存储挂载节点',
              value: sortedBuckets.length,
              icon: <DatabaseOutlined style={{ color: '#1677ff' }} />,
            }}
          />
          <StatisticCard
            statistic={{
              title: '默认节点',
              value: defaultBucket?.name ?? '未设置',
              icon: <CloudOutlined style={{ color: '#52c41a' }} />,
            }}
          />
          <StatisticCard
            statistic={{
              title: '当前节点资产数',
              value: allAssets.length,
              icon: <FolderOpenOutlined style={{ color: '#fa8c16' }} />,
            }}
          />
          <StatisticCard
            statistic={{
              title: 'ISO / Depot / 驱动',
              value: `${isoQuery.data?.length ?? 0} / ${depotsQuery.data?.length ?? 0} / ${allDriversQuery.data?.length ?? 0}`,
              icon: <HddOutlined style={{ color: '#722ed1' }} />,
            }}
          />
        </StatisticCard.Group>

        <Card>
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as 'files' | 'buckets')}
            size="large"
            items={[
              {
                key: 'files',
                label: (
                  <Space size={8}>
                    <FolderOpenOutlined />
                    <span>文件库管理 ({allAssets.length})</span>
                  </Space>
                ),
                children: (
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <div
                      style={{
                        padding: '12px 16px',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 8,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 12,
                      }}
                    >
                      <Space wrap size={12}>
                        <Typography.Text strong>当前操作存储节点：</Typography.Text>
                        <Select
                          style={{ width: 280 }}
                          placeholder="选择存储节点"
                          value={selectedBucketId}
                          onChange={setBucketId}
                          options={(bucketsQuery.data ?? []).map((b) => ({
                            value: b.id,
                            label: `${b.name} (${bucketType(b).toUpperCase()})${b.is_default ? ' [默认]' : ''}`,
                          }))}
                        />
                        {selectedBucket && (
                          <Space size={6}>
                            <Tag color={bucketType(selectedBucket) === 'local' ? 'purple' : 'blue'}>
                              {bucketType(selectedBucket).toUpperCase()}
                            </Tag>
                            {selectedBucket.is_default && <Tag color="success">默认</Tag>}
                            <Typography.Text className="mono" type="secondary" style={{ fontSize: 12 }}>
                              {bucketLocation(selectedBucket)}
                            </Typography.Text>
                          </Space>
                        )}
                      </Space>

                      <Space wrap size={8}>
                        <Button
                          size="middle"
                          icon={<ReloadOutlined />}
                          onClick={() => refreshMutation.mutate()}
                          loading={refreshMutation.isPending}
                          disabled={!selectedBucketId}
                        >
                          刷新元数据
                        </Button>
                        <Button
                          size="middle"
                          icon={<SettingOutlined />}
                          onClick={() => setActiveTab('buckets')}
                        >
                          管理存储挂载
                        </Button>
                      </Space>
                    </div>

                    <Card
                      title="上传文件到当前存储"
                      size="small"
                      variant="outlined"
                      style={{ background: '#fafafa' }}
                    >
                      <Space wrap align="end" className="upload-toolbar">
                        <div>
                          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                            文件类型
                          </Typography.Text>
                          <Select<UploadType>
                            style={{ width: 140 }}
                            value={uploadType}
                            onChange={setUploadType}
                            options={[
                              { value: 'depot', label: 'Depot 补丁包' },
                              { value: 'driver', label: '网卡/存储驱动' },
                              { value: 'iso', label: '基础 ISO 镜像' },
                            ]}
                          />
                        </div>

                        {uploadType !== 'iso' && (
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                              ESXi 版本
                            </Typography.Text>
                            <Select
                              style={{ width: 120 }}
                              value={version}
                              onChange={setVersion}
                              options={esxiVersions.map((item) => ({ value: item, label: `ESXi ${item}` }))}
                            />
                          </div>
                        )}

                        {uploadType === 'driver' && (
                          <div>
                            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                              驱动分类
                            </Typography.Text>
                            <Select
                              style={{ width: 120 }}
                              value={category}
                              onChange={setCategory}
                              options={categories}
                            />
                          </div>
                        )}

                        <div>
                          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                            选择本地文件
                          </Typography.Text>
                          <Upload
                            beforeUpload={() => false}
                            maxCount={1}
                            fileList={fileList}
                            onChange={({ fileList: next }) => setFileList(next)}
                          >
                            <Button icon={<UploadOutlined />}>选择文件</Button>
                          </Upload>
                        </div>

                        <Button
                          type="primary"
                          onClick={() => uploadMutation.mutate()}
                          loading={uploadMutation.isPending}
                          disabled={!selectedBucketId || fileList.length === 0}
                        >
                          立即上传
                        </Button>
                      </Space>
                    </Card>

                    <Tabs
                      defaultActiveKey="all"
                      items={[
                        {
                          key: 'all',
                          label: `全部资产 (${allAssets.length})`,
                          children: (
                            <Table
                              rowKey="id"
                              size="middle"
                              columns={fileColumns('depot')}
                              dataSource={allAssets}
                              loading={depotsQuery.isLoading || allDriversQuery.isLoading || isoQuery.isLoading}
                              pagination={{ pageSize: 10 }}
                            />
                          ),
                        },
                        {
                          key: 'depots',
                          label: `Depot 补丁包 (${depotsQuery.data?.length ?? 0})`,
                          children: (
                            <Table
                              rowKey="id"
                              size="middle"
                              columns={fileColumns('depot')}
                              dataSource={depotsQuery.data ?? []}
                              loading={depotsQuery.isLoading}
                              pagination={{ pageSize: 10 }}
                            />
                          ),
                        },
                        {
                          key: 'drivers',
                          label: `驱动包 (${allDriversQuery.data?.length ?? 0})`,
                          children: (
                            <Table
                              rowKey="id"
                              size="middle"
                              columns={fileColumns('driver')}
                              dataSource={allDriversQuery.data ?? []}
                              loading={allDriversQuery.isLoading}
                              pagination={{ pageSize: 10 }}
                            />
                          ),
                        },
                        {
                          key: 'isos',
                          label: `ISO 镜像 (${isoQuery.data?.length ?? 0})`,
                          children: (
                            <Table
                              rowKey="id"
                              size="middle"
                              columns={fileColumns('iso')}
                              dataSource={isoQuery.data ?? []}
                              loading={isoQuery.isLoading}
                              pagination={{ pageSize: 10 }}
                            />
                          ),
                        },
                      ]}
                    />
                  </Space>
                ),
              },
              {
                key: 'buckets',
                label: (
                  <Space size={8}>
                    <DatabaseOutlined />
                    <span>存储挂载节点 (${sortedBuckets.length})</span>
                  </Space>
                ),
                children: (
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography.Text type="secondary">
                        管理本地文件目录或 S3/MinIO/Cloudflare R2 对象存储端点。
                      </Typography.Text>
                      <Space>
                        <Button
                          icon={<ReloadOutlined />}
                          onClick={() => bucketsQuery.refetch()}
                          loading={bucketsQuery.isFetching}
                        >
                          刷新节点
                        </Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateBucket}>
                          新建存储挂载
                        </Button>
                      </Space>
                    </div>

                    <Table
                      rowKey="id"
                      size="middle"
                      columns={bucketColumns}
                      dataSource={sortedBuckets}
                      loading={bucketsQuery.isLoading}
                      pagination={false}
                      scroll={{ x: 960 }}
                    />
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      </Space>

      <Modal
        title={editingBucket ? '编辑存储节点' : '新建存储节点'}
        open={bucketModalOpen}
        onCancel={closeBucketModal}
        onOk={() => bucketForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={saveBucketMutation.isPending}
        width={720}
        destroyOnClose
      >
        <Form
          form={bucketForm}
          layout="vertical"
          initialValues={defaultBucketPayload}
          onFinish={(values) => saveBucketMutation.mutate(values)}
        >
          <Form.Item name="type" label="存储类型" rules={[{ required: true }]}>
            <Select
              onChange={(value) => setStorageType(value)}
              options={[
                { value: 's3', label: 'S3 / MinIO 兼容对象存储' },
                { value: 'local', label: '容器本地目录挂载 (Local Path)' },
              ]}
            />
          </Form.Item>

          <Form.Item name="name" label="节点显示名称" rules={[{ required: true, message: '请输入存储节点名称' }]}>
            <Input placeholder="例如：Local Storage 或 MinIO Cluster" />
          </Form.Item>

          {storageType === 'local' ? (
            <Form.Item
              name="local_path"
              label="本地挂载路径"
              rules={[{ required: true, message: '请输入容器内本地路径' }]}
              extra="容器内的实际存储目录，例如 /data/storage"
            >
              <Input placeholder="/data/storage" />
            </Form.Item>
          ) : (
            <>
              <Form.Item name="endpoint" label="Endpoint 端点" rules={[{ required: true, message: '请输入 S3 端点' }]}>
                <Input placeholder="s3.amazonaws.com 或 play.min.io" />
              </Form.Item>
              <Form.Item name="bucket_name" label="Bucket 名称" rules={[{ required: true, message: '请输入 Bucket 名' }]}>
                <Input placeholder="esxi-builds" />
              </Form.Item>
              <Form.Item name="region" label="Region 区域">
                <Input placeholder="us-east-1 或 default" />
              </Form.Item>
              <Form.Item name="access_key" label="Access Key" rules={[{ required: true, message: '请输入 Access Key' }]}>
                <Input placeholder="AKIA..." />
              </Form.Item>
              <Form.Item
                name="secret_key"
                label="Secret Key"
                rules={[{ required: !editingBucket, message: '请输入 Secret Key' }]}
                extra={editingBucket ? '留空表示保持原有 Secret Key 不变' : undefined}
              >
                <Input.Password placeholder="Secret Key" />
              </Form.Item>
              <Form.Item name="public_domain" label="公网直链域名 (可选)" extra="用于对外提供产物直接下载 URL">
                <Input placeholder="https://download.yourdomain.com" />
              </Form.Item>
              <Form.Item name="use_ssl" label="启用 SSL (HTTPS)" valuePropName="checked">
                <Switch />
              </Form.Item>
            </>
          )}

          <Form.Item name="is_default" label="设为默认存储节点" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="重命名文件"
        open={Boolean(renaming)}
        onCancel={() => {
          setRenaming(null)
          renameForm.resetFields()
        }}
        onOk={() => renameForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={renameMutation.isPending}
      >
        <Form
          form={renameForm}
          layout="vertical"
          onFinish={({ new_name }) => {
            if (renaming && new_name?.trim()) {
              renameMutation.mutate({ fileId: renaming.id, newName: new_name.trim() })
            }
          }}
        >
          <Form.Item
            name="new_name"
            label="新文件名"
            rules={[{ required: true, message: '请输入新文件名' }]}
          >
            <Input placeholder="新文件名" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  )
}
