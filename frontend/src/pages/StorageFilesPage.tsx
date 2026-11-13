import {
  ApiOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  HddOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  SearchOutlined,
  StarOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { UploadFile } from 'antd/es/upload/interface'
import { useMemo, useState } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
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
import { PageContainer, ProCard } from '../components/pro-compat'
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
type AssetCategoryTab = 'all' | 'depot' | 'driver' | 'iso'

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

const driverCategories = [
  { value: 'network', label: '网卡驱动 (Network)' },
  { value: 'storage', label: '存储控制 (Storage)' },
  { value: 'raid', label: '阵列卡 (RAID)' },
  { value: 'other', label: '其他驱动 (Other)' },
]

export default function StorageFilesPage() {
  const queryClient = useQueryClient()
  const [messageApi, contextHolder] = message.useMessage()
  const inRouter = useInRouterContext()
  const routerNavigate = inRouter ? useNavigate() : null
  const go = (path: string) => {
    if (routerNavigate) {
      routerNavigate(path)
    } else {
      window.location.assign(path)
    }
  }

  // Storage Node Drawer State
  const [bucketForm] = Form.useForm<BucketPayload>()
  const [bucketDrawerOpen, setBucketDrawerOpen] = useState(false)
  const [editingBucket, setEditingBucket] = useState<StorageBucket | null>(null)
  const [storageType, setStorageType] = useState<'s3' | 'local'>('s3')
  const [testingNodeId, setTestingNodeId] = useState<number | null>(null)

  // Asset Workspace State
  const [bucketId, setBucketId] = useState<number | undefined>()
  const [assetTab, setAssetTab] = useState<AssetCategoryTab>('all')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [versionFilter, setVersionFilter] = useState<string>('all')

  // Upload Panel State
  const [uploadExpanded, setUploadExpanded] = useState(true)
  const [uploadType, setUploadType] = useState<UploadType>('depot')
  const [uploadVersion, setUploadVersion] = useState('8.0')
  const [uploadCategory, setUploadCategory] = useState('network')
  const [fileList, setFileList] = useState<UploadFile[]>([])

  // Rename Modal State
  const [renaming, setRenaming] = useState<FileMetadata | null>(null)
  const [renameForm] = Form.useForm<{ new_name: string }>()

  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const sortedBuckets = useMemo(
    () => [...(bucketsQuery.data ?? [])].sort((a, b) => Number(b.is_default) - Number(a.is_default)),
    [bucketsQuery.data]
  )

  const selectedBucketId = useMemo(
    () => bucketId ?? sortedBuckets.find((b) => b.is_default)?.id ?? sortedBuckets[0]?.id,
    [bucketId, sortedBuckets]
  )
  const selectedBucket = useMemo(
    () => sortedBuckets.find((b) => b.id === selectedBucketId),
    [sortedBuckets, selectedBucketId]
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
  const isoQuery = useQuery({
    queryKey: ['isos', selectedBucketId],
    queryFn: () => listISOs(selectedBucketId as number),
    enabled: Boolean(selectedBucketId),
  })

  const depots = depotsQuery.data ?? []
  const drivers = allDriversQuery.data ?? []
  const isos = isoQuery.data ?? []

  const allAssets = useMemo(() => {
    const map = new Map<number, FileMetadata>()
    for (const item of [...depots, ...drivers, ...isos]) {
      map.set(item.id, item)
    }
    return Array.from(map.values())
  }, [depots, drivers, isos])

  const filteredAssets = useMemo(() => {
    const source =
      assetTab === 'depot'
        ? depots
        : assetTab === 'driver'
          ? drivers
          : assetTab === 'iso'
            ? isos
            : allAssets

    const kw = searchKeyword.trim().toLowerCase()
    return source.filter((item) => {
      const matchVersion = versionFilter === 'all' || item.esxi_version === versionFilter
      const matchKeyword =
        !kw ||
        item.path.toLowerCase().includes(kw) ||
        (item.driver_name && item.driver_name.toLowerCase().includes(kw)) ||
        (item.driver_description && item.driver_description.toLowerCase().includes(kw))
      return matchVersion && matchKeyword
    })
  }, [assetTab, depots, drivers, isos, allAssets, searchKeyword, versionFilter])

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

  const closeBucketDrawer = () => {
    setBucketDrawerOpen(false)
    setEditingBucket(null)
    setStorageType('s3')
    bucketForm.resetFields()
  }

  const openCreateBucket = () => {
    setEditingBucket(null)
    setStorageType('local')
    bucketForm.setFieldsValue({ ...defaultBucketPayload, type: 'local', local_path: '/data/storage' })
    setBucketDrawerOpen(true)
  }

  const openEditBucket = (bucket: StorageBucket) => {
    const nextType = bucket.type === 'local' ? 'local' : 's3'
    setEditingBucket(bucket)
    setStorageType(nextType)
    bucketForm.setFieldsValue({
      name: bucket.name,
      type: nextType,
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
    setBucketDrawerOpen(true)
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
      closeBucketDrawer()
      await invalidateBuckets()
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const deleteBucketMutation = useMutation({
    mutationFn: deleteBucket,
    onSuccess: async (_, deletedId) => {
      messageApi.success('存储节点已移除')
      if (bucketId === deletedId) setBucketId(undefined)
      await invalidateBuckets()
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const setDefaultMutation = useMutation({
    mutationFn: setDefaultBucket,
    onSuccess: async () => {
      messageApi.success('已设为默认存储节点')
      await invalidateBuckets()
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const testConnectionMutation = useMutation({
    mutationFn: async (id: number) => {
      setTestingNodeId(id)
      try {
        return await testBucketConnection(id)
      } finally {
        setTestingNodeId(null)
      }
    },
    onSuccess: (res) => {
      if (res.connected) {
        messageApi.success('节点连通性测试通过')
      } else {
        messageApi.error('节点连接测试失败，请检查路径或密钥配置')
      }
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBucketId || fileList.length === 0) return
      const rawFile = (fileList[0].originFileObj ?? fileList[0]) as unknown as File
      return uploadFile(
        selectedBucketId,
        uploadType,
        rawFile,
        uploadType === 'iso' ? undefined : uploadVersion,
        uploadType === 'driver' ? uploadCategory : undefined
      )
    },
    onSuccess: async () => {
      messageApi.success('资产上传成功，已自动同步列表')
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
    mutationFn: ({ fileId, newName }: { fileId: number; newName: string }) => renameFile(fileId, newName),
    onSuccess: async () => {
      messageApi.success('文件重命名成功')
      setRenaming(null)
      renameForm.resetFields()
      await invalidateFiles()
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const refreshMutation = useMutation({
    mutationFn: () => refreshFiles(selectedBucketId as number),
    onSuccess: async () => {
      messageApi.success('已重新扫描并刷新节点资产元数据')
      await invalidateFiles()
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const handleSmartFilePick = (nextList: UploadFile[]) => {
    setFileList(nextList)
    if (nextList.length > 0) {
      const lower = (nextList[0].name || '').toLowerCase()
      if (lower.endsWith('.vib')) {
        setUploadType('driver')
      } else if (lower.includes('depot') && lower.endsWith('.zip')) {
        setUploadType('depot')
      }
      const verMatch = lower.match(/(6\.5|6\.7|7\.0|8\.0|9\.0)/)
      if (verMatch) {
        setUploadVersion(verMatch[1])
      }
    }
  }

  const columns: ColumnsType<FileMetadata> = [
    {
      title: '资产名称与存储路径',
      key: 'path',
      render: (_, file) => (
        <div className="table-cell-stack">
          <Space size={6} wrap>
            <Typography.Text strong>{assetTitle(file)}</Typography.Text>
            {file.driver_version && <Tag style={{ marginInlineEnd: 0 }}>v{file.driver_version}</Tag>}
          </Space>
          <Typography.Text className="mono table-path" type="secondary" copyable ellipsis style={{ maxWidth: 420, fontSize: 12 }}>
            {file.path}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '类型',
      key: 'type',
      width: 96,
      render: (_, file) => {
        const label = assetTypeText(file)
        const color = file.type === 'depot' ? 'blue' : file.type === 'driver' ? 'cyan' : 'purple'
        return <Tag color={color}>{label}</Tag>
      },
    },
    {
      title: '适用版本',
      dataIndex: 'esxi_version',
      width: 96,
      render: (val: string | undefined) => (val ? <Tag color="geekblue">ESXi {val}</Tag> : <Tag>通用</Tag>),
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 105,
      render: (val: number | undefined) => <span className="mono tabular-nums">{compactSize(val)}</span>,
    },
    {
      title: '缓存状态',
      key: 'cache',
      width: 108,
      render: (_, file) => (
        <Tag color={cacheStatusColor(file, selectedBucket)}>{cacheStatusText(file, selectedBucket)}</Tag>
      ),
    },
    {
      title: '最近修改',
      dataIndex: 'last_modified',
      width: 165,
      render: (val: string | undefined) => (
        <span className="tabular-nums" style={{ color: '#64748b', fontSize: 12 }}>
          {formatDate(val || '')}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 215,
      render: (_, file) => {
        const canUseAsBase = file.type === 'depot' || (file.type === 'iso' && !file.path.toLowerCase().startsWith('output/'))
        return (
          <Space size={4} wrap>
            {canUseAsBase && selectedBucketId && (
              <Tooltip title="将此镜像作为基础源带入构建工作台">
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<RocketOutlined />}
                  onClick={() => {
                    const params = new URLSearchParams({
                      bucket: String(selectedBucketId),
                      depot: file.path,
                    })
                    if (file.esxi_version) params.set('version', file.esxi_version)
                    go(`/build?${params.toString()}`)
                  }}
                >
                  去构建
                </Button>
              </Tooltip>
            )}
            {selectedBucket?.public_domain && (
              <Tooltip title="复制公网下载直链">
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  aria-label="复制直链"
                  onClick={() => {
                    const url = buildPublicObjectUrl(selectedBucket.public_domain, file.path || '')
                    if (url) {
                      navigator.clipboard.writeText(url)
                      messageApi.success('已复制公网直链')
                    }
                  }}
                />
              </Tooltip>
            )}
            <Tooltip title="重命名">
              <Button
                size="small"
                icon={<EditOutlined />}
                aria-label="重命名文件"
                onClick={() => {
                  setRenaming(file)
                  renameForm.setFieldsValue({ new_name: file.path.split('/').pop() || assetTitle(file) })
                }}
              />
            </Tooltip>
            <Popconfirm
              title="确认从文件库删除该资产？"
              onConfirm={() => deleteFileMutation.mutate(file.id)}
              okText="删除"
              cancelText="取消"
            >
              <Button size="small" danger icon={<DeleteOutlined />} aria-label="删除文件" />
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  const assetsLoading = depotsQuery.isLoading || allDriversQuery.isLoading || isoQuery.isLoading

  return (
    <PageContainer
      title="存储挂载与文件库"
      subTitle="左侧切换管理本地/S3 存储节点，右侧拖拽上传并管理基础镜像、驱动包与 ISO 产物"
      extra={[
        <Button key="new-node" icon={<PlusOutlined />} onClick={openCreateBucket}>
          新建存储节点
        </Button>,
        <Button key="go-build" type="primary" icon={<RocketOutlined />} onClick={() => go('/build')}>
          前往构建工作台
        </Button>,
      ]}
    >
      {contextHolder}

      <div className="storage-master-detail">
        {/* Left Rail: Storage Mount Nodes */}
        <aside className="storage-nodes-rail" aria-label="存储挂载节点列表">
          <ProCard
            title={
              <Space size={6}>
                <DatabaseOutlined style={{ color: '#2563eb' }} />
                <span>存储节点 ({sortedBuckets.length})</span>
              </Space>
            }
            bordered
            headerBordered
            extra={
              <Tooltip title="刷新存储节点">
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={bucketsQuery.isFetching}
                  onClick={() => bucketsQuery.refetch()}
                  aria-label="刷新存储节点"
                />
              </Tooltip>
            }
          >
            {sortedBuckets.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无存储节点">
                <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreateBucket}>
                  添加首个存储
                </Button>
              </Empty>
            ) : (
              <div className="node-card-list">
                {sortedBuckets.map((node) => {
                  const active = node.id === selectedBucketId
                  const isLocal = bucketType(node) === 'local'
                  return (
                    <div
                      key={node.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={active}
                      className={`node-item-card ${active ? 'node-item-card-active' : ''}`}
                      onClick={() => setBucketId(node.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setBucketId(node.id)
                        }
                      }}
                    >
                      <div className="node-item-header">
                        <Space size={6} wrap>
                          {isLocal ? <HddOutlined /> : <CloudServerOutlined />}
                          <Typography.Text strong>{node.name}</Typography.Text>
                        </Space>
                        <Space size={4}>
                          <Tag color={isLocal ? 'purple' : 'blue'} style={{ marginInlineEnd: 0 }}>
                            {isLocal ? 'LOCAL' : 'S3'}
                          </Tag>
                          {node.is_default && (
                            <Tag color="success" style={{ marginInlineEnd: 0 }}>
                              默认
                            </Tag>
                          )}
                        </Space>
                      </div>

                      <Typography.Text
                        type="secondary"
                        className="mono node-item-path"
                        ellipsis={{ tooltip: bucketLocation(node) }}
                      >
                        {bucketLocation(node)}
                      </Typography.Text>

                      <div className="node-item-actions" onClick={(e) => e.stopPropagation()}>
                        <Tooltip title="测试连通性">
                          <Button
                            size="small"
                            type="text"
                            icon={<ApiOutlined />}
                            loading={testingNodeId === node.id}
                            onClick={() => testConnectionMutation.mutate(node.id)}
                          >
                            测速
                          </Button>
                        </Tooltip>
                        {!node.is_default && (
                          <Tooltip title="设为系统默认节点">
                            <Button
                              size="small"
                              type="text"
                              icon={<StarOutlined />}
                              onClick={() => setDefaultMutation.mutate(node.id)}
                            >
                              默认
                            </Button>
                          </Tooltip>
                        )}
                        <Button
                          size="small"
                          type="text"
                          icon={<EditOutlined />}
                          onClick={() => openEditBucket(node)}
                        >
                          编辑
                        </Button>
                        <Popconfirm
                          title="移除此存储挂载？"
                          description="仅解除挂载配置，不会删除磁盘或远端桶内真实文件。"
                          onConfirm={() => deleteBucketMutation.mutate(node.id)}
                          okText="移除"
                          cancelText="取消"
                        >
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`删除节点 ${node.name}`} />
                        </Popconfirm>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </ProCard>
        </aside>

        {/* Right Main Workspace: Asset Upload & Repository */}
        <div className="storage-assets-main">
          {/* Active Node Banner & Quick Upload Drawer/Panel */}
          <ProCard
            bordered
            headerBordered
            title={
              selectedBucket ? (
                <Space size={8} wrap>
                  <Badge status="processing" />
                  <Typography.Text strong>当前浏览：{selectedBucket.name}</Typography.Text>
                  <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                    基础源 {depots.length}
                  </Tag>
                  <Tag color="cyan" style={{ marginInlineEnd: 0 }}>
                    驱动 {drivers.length}
                  </Tag>
                  <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                    ISO {isos.length}
                  </Tag>
                </Space>
              ) : (
                '请先选择或创建存储节点'
              )
            }
            extra={
              <Space size={8} wrap>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  disabled={!selectedBucketId}
                  loading={refreshMutation.isPending}
                  onClick={() => refreshMutation.mutate()}
                >
                  重新扫描目录
                </Button>
                <Button
                  size="small"
                  type={uploadExpanded ? 'default' : 'primary'}
                  icon={<CloudUploadOutlined />}
                  onClick={() => setUploadExpanded(!uploadExpanded)}
                >
                  {uploadExpanded ? '收起上传区' : '展开上传区'}
                </Button>
              </Space>
            }
          >
            {uploadExpanded && (
              <div className="smart-upload-panel">
                <div className="smart-upload-controls">
                  <div className="smart-upload-field">
                    <span className="field-caption">1. 资产归类用途</span>
                    <Segmented<UploadType>
                      block
                      value={uploadType}
                      onChange={setUploadType}
                      options={[
                        { value: 'depot', label: '基础源 (ISO / Depot)' },
                        { value: 'driver', label: '驱动包 (VIB / ZIP)' },
                        { value: 'iso', label: '普通 ISO 归档' },
                      ]}
                    />
                  </div>

                  {uploadType !== 'iso' && (
                    <div className="smart-upload-field" style={{ minWidth: 136 }}>
                      <span className="field-caption">2. 目标 ESXi 版本</span>
                      <Select
                        style={{ width: '100%' }}
                        value={uploadVersion}
                        onChange={setUploadVersion}
                        options={esxiVersions.map((item) => ({ value: item, label: `ESXi ${item}` }))}
                      />
                    </div>
                  )}

                  {uploadType === 'driver' && (
                    <div className="smart-upload-field" style={{ minWidth: 170 }}>
                      <span className="field-caption">3. 驱动硬件分类</span>
                      <Select
                        style={{ width: '100%' }}
                        value={uploadCategory}
                        onChange={setUploadCategory}
                        options={driverCategories}
                      />
                    </div>
                  )}

                  <div className="smart-upload-submit">
                    <Button
                      type="primary"
                      icon={<CloudUploadOutlined />}
                      loading={uploadMutation.isPending}
                      disabled={!selectedBucketId || fileList.length === 0}
                      onClick={() => uploadMutation.mutate()}
                    >
                      立即上传入库
                    </Button>
                  </div>
                </div>

                <Upload.Dragger
                  multiple={false}
                  maxCount={1}
                  accept=".iso,.zip,.vib"
                  beforeUpload={() => false}
                  fileList={fileList}
                  onChange={({ fileList: next }) => handleSmartFilePick(next)}
                  className="compact-dragger"
                >
                  <p className="ant-upload-drag-icon" style={{ marginBottom: 6 }}>
                    <InboxOutlined style={{ fontSize: 28, color: '#2563eb' }} />
                  </p>
                  <p className="ant-upload-text" style={{ fontSize: 13, marginBottom: 2 }}>
                    点击或将 <strong>.iso / .zip / .vib</strong> 文件拖拽到此处（自动识别驱动与版本号）
                  </p>
                  <p className="ant-upload-hint" style={{ fontSize: 12 }}>
                    提示：用于定制注入的原版 ESXi 安装镜像请选择「基础源 (ISO / Depot)」，上传后即可在构建工作台选用。
                  </p>
                </Upload.Dragger>
              </div>
            )}

            {/* Filter Toolbar */}
            <div className="asset-filter-bar">
              <Segmented<AssetCategoryTab>
                value={assetTab}
                onChange={setAssetTab}
                options={[
                  { value: 'all', label: `全部 (${allAssets.length})` },
                  { value: 'depot', label: `基础源 (${depots.length})` },
                  { value: 'driver', label: `驱动包 (${drivers.length})` },
                  { value: 'iso', label: `ISO 镜像 (${isos.length})` },
                ]}
              />

              <Space size={8} wrap>
                <Select
                  style={{ width: 128 }}
                  value={versionFilter}
                  onChange={setVersionFilter}
                  options={[
                    { value: 'all', label: '全部版本' },
                    ...esxiVersions.map((v) => ({ value: v, label: `ESXi ${v}` })),
                  ]}
                />
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="搜索文件名、驱动名或描述..."
                  style={{ width: 230 }}
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                />
              </Space>
            </div>

            <Table
              rowKey="id"
              size="middle"
              columns={columns}
              dataSource={filteredAssets}
              loading={assetsLoading}
              pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'] }}
              scroll={{ x: 880 }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={searchKeyword || versionFilter !== 'all' ? '没有符合筛选条件的文件' : '当前存储节点暂无文件，请通过上方拖拽区上传'}
                  />
                ),
              }}
            />
          </ProCard>
        </div>
      </div>

      {/* Node Create / Edit Drawer */}
      <Drawer
        title={editingBucket ? `编辑存储节点 · ${editingBucket.name}` : '新建存储挂载节点'}
        open={bucketDrawerOpen}
        onClose={closeBucketDrawer}
        width={460}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={closeBucketDrawer}>取消</Button>
            <Button
              type="primary"
              icon={<CheckCircleFilled />}
              loading={saveBucketMutation.isPending}
              onClick={() => bucketForm.submit()}
            >
              保存节点
            </Button>
          </Space>
        }
      >
        <Form
          form={bucketForm}
          layout="vertical"
          initialValues={defaultBucketPayload}
          onFinish={(values) => saveBucketMutation.mutate(values)}
        >
          <Form.Item name="type" label="存储后端类型" rules={[{ required: true }]}>
            <Segmented
              block
              onChange={(val) => setStorageType(val as 's3' | 'local')}
              options={[
                { value: 'local', label: '容器本地目录 (Local)' },
                { value: 's3', label: 'S3 / MinIO / R2 对象存储' },
              ]}
            />
          </Form.Item>

          <Form.Item name="name" label="节点显示名称" rules={[{ required: true, message: '请输入存储节点名称' }]}>
            <Input placeholder="例如：Local NVMe Storage 或 MinIO Cluster" />
          </Form.Item>

          {storageType === 'local' ? (
            <Form.Item
              name="local_path"
              label="容器内挂载路径"
              rules={[{ required: true, message: '请输入容器内本地路径' }]}
              extra="容器内真实读写目录，默认推荐 /data/storage"
            >
              <Input className="mono" placeholder="/data/storage" />
            </Form.Item>
          ) : (
            <>
              <Form.Item name="endpoint" label="Endpoint 端点地址" rules={[{ required: true, message: '请输入 S3 端点' }]}>
                <Input className="mono" placeholder="192.168.0.10:9000 或 s3.amazonaws.com" />
              </Form.Item>
              <Form.Item name="bucket_name" label="Bucket 桶名称" rules={[{ required: true, message: '请输入 Bucket 名' }]}>
                <Input className="mono" placeholder="esxi-assets" />
              </Form.Item>
              <Form.Item name="region" label="Region 区域">
                <Input className="mono" placeholder="us-east-1 或 auto" />
              </Form.Item>
              <Form.Item name="access_key" label="Access Key" rules={[{ required: true, message: '请输入 Access Key' }]}>
                <Input className="mono" placeholder="Access Key ID" />
              </Form.Item>
              <Form.Item
                name="secret_key"
                label="Secret Key"
                rules={[{ required: !editingBucket, message: '请输入 Secret Key' }]}
                extra={editingBucket ? '留空表示保持原密钥不变' : undefined}
              >
                <Input.Password placeholder="Secret Access Key" />
              </Form.Item>
              <Form.Item name="public_domain" label="公网访问域名 (可选)" extra="配置后支持一键复制产物公网下载直链">
                <Input className="mono" placeholder="https://dl.example.com" />
              </Form.Item>
              <Form.Item name="use_ssl" label="启用 HTTPS (SSL)" valuePropName="checked">
                <Switch />
              </Form.Item>
            </>
          )}

          <Form.Item name="is_default" label="设为默认存储节点" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>

      {/* File Rename Modal (IME-safe Enter submit) */}
      <Modal
        title="重命名资产文件"
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
            label="新文件名称"
            rules={[{ required: true, message: '请输入新文件名' }]}
          >
            <Input
              placeholder="输入新文件名"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  renameForm.submit()
                }
              }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  )
}
