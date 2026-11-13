import {
  ApiOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CloudServerOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  HddOutlined,
  InboxOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
  ThunderboltOutlined,
} from '../components/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Radio,
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
  testBucketConfig,
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
import { PageContainer } from '../components/pro-compat'
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
  fileName,
} from './pipelineUtils'

type UploadType = 'depot' | 'driver' | 'iso'
type AssetCategoryTab = 'depot' | 'driver' | 'iso'

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
  { value: 'storage', label: '存储控制器 (Storage)' },
  { value: 'raid', label: 'RAID 阵列卡 (RAID)' },
  { value: 'other', label: '其他驱动 (Other)' },
]

interface CloudProviderPreset {
  key: string
  name: string
  label: string
  endpoint: string
  region: string
  useSSL: boolean
}

const S3_PRESETS: CloudProviderPreset[] = [
  { key: 'minio', name: 'MinIO 集群', label: 'MinIO (私有部署)', endpoint: '192.168.0.10:9000', region: 'us-east-1', useSSL: false },
  { key: 'aws', name: 'AWS S3', label: 'Amazon S3', endpoint: 's3.us-east-1.amazonaws.com', region: 'us-east-1', useSSL: true },
  { key: 'r2', name: 'Cloudflare R2', label: 'Cloudflare R2', endpoint: '<account-id>.r2.cloudflarestorage.com', region: 'auto', useSSL: true },
  { key: 'aliyun', name: '阿里云 OSS', label: 'Aliyun OSS', endpoint: 'oss-cn-hangzhou.aliyuncs.com', region: 'oss-cn-hangzhou', useSSL: true },
  { key: 'tencent', name: '腾讯云 COS', label: 'Tencent COS', endpoint: 'cos.ap-guangzhou.myqcloud.com', region: 'ap-guangzhou', useSSL: true },
  { key: 'custom', name: 'S3 兼容存储', label: '通用 S3 兼容', endpoint: '', region: 'us-east-1', useSSL: true },
]

export default function StorageFilesPage() {
  const queryClient = useQueryClient()
  const [messageApi, contextHolder] = message.useMessage()
  const inRouter = useInRouterContext()
  const routerNavigate = inRouter ? useNavigate() : null
  const go = (path: string) => {
    if (routerNavigate) routerNavigate(path)
    else window.location.assign(path)
  }

  // Mount S3/Local Drawer State
  const [mountForm] = Form.useForm<BucketPayload>()
  const [mountDrawerOpen, setMountDrawerOpen] = useState(false)
  const [editingBucket, setEditingBucket] = useState<StorageBucket | null>(null)
  const [storageType, setStorageType] = useState<'s3' | 'local'>('s3')
  const [testingConfigLoading, setTestingConfigLoading] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testingNodeId, setTestingNodeId] = useState<number | null>(null)

  // Current Active Storage Mount
  const [bucketId, setBucketId] = useState<number | undefined>()
  const [categoryTab, setCategoryTab] = useState<AssetCategoryTab>('depot')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [versionFilter, setVersionFilter] = useState<string>('all')

  // Upload Area State
  const [uploadDrawerOpen, setUploadDrawerOpen] = useState(false)
  const [uploadType, setUploadType] = useState<UploadType>('depot')
  const [uploadVersion, setUploadVersion] = useState('8.0')
  const [uploadCategory, setUploadCategory] = useState('network')
  const [fileList, setFileList] = useState<UploadFile[]>([])

  // Rename Modal State
  const [renaming, setRenaming] = useState<FileMetadata | null>(null)
  const [renameForm] = Form.useForm<{ new_name: string }>()

  // Query: Storage Buckets
  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const buckets = useMemo(() => {
    const list = bucketsQuery.data ?? []
    return [...list].sort((a, b) => Number(b.is_default) - Number(a.is_default))
  }, [bucketsQuery.data])

  const selectedBucketId = useMemo(
    () => bucketId ?? buckets.find((b) => b.is_default)?.id ?? buckets[0]?.id,
    [bucketId, buckets]
  )
  const selectedBucket = useMemo(
    () => buckets.find((b) => b.id === selectedBucketId),
    [buckets, selectedBucketId]
  )

  // Query Files in active bucket
  const depotsQuery = useQuery({
    queryKey: ['depots', selectedBucketId],
    queryFn: () => listDepots(selectedBucketId as number),
    enabled: Boolean(selectedBucketId),
  })
  const driversQuery = useQuery({
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
  const drivers = driversQuery.data ?? []
  const isos = isoQuery.data ?? []

  const currentCategoryFiles = useMemo(() => {
    const source = categoryTab === 'depot' ? depots : categoryTab === 'driver' ? drivers : isos
    const kw = searchKeyword.trim().toLowerCase()
    return source.filter((item) => {
      const matchVer = versionFilter === 'all' || item.esxi_version === versionFilter
      const matchKw =
        !kw ||
        item.path.toLowerCase().includes(kw) ||
        (item.driver_name && item.driver_name.toLowerCase().includes(kw)) ||
        (item.driver_description && item.driver_description.toLowerCase().includes(kw))
      return matchVer && matchKw
    })
  }, [categoryTab, depots, drivers, isos, searchKeyword, versionFilter])

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

  // Mount Drawer Helpers
  const closeMountDrawer = () => {
    setMountDrawerOpen(false)
    setEditingBucket(null)
    setStorageType('s3')
    setTestResult(null)
    mountForm.resetFields()
  }

  const openMountS3 = () => {
    setEditingBucket(null)
    setStorageType('s3')
    setTestResult(null)
    mountForm.setFieldsValue({
      ...defaultBucketPayload,
      type: 's3',
      name: 'MinIO 集群',
      endpoint: '192.168.0.10:9000',
      region: 'us-east-1',
      use_ssl: false,
    })
    setMountDrawerOpen(true)
  }

  const openMountLocal = () => {
    setEditingBucket(null)
    setStorageType('local')
    setTestResult(null)
    mountForm.setFieldsValue({
      ...defaultBucketPayload,
      type: 'local',
      name: '本地专用挂载盘',
      local_path: '/data/storage',
      use_ssl: true,
    })
    setMountDrawerOpen(true)
  }

  const openEditMount = (b: StorageBucket) => {
    const nextType = b.type === 'local' ? 'local' : 's3'
    setEditingBucket(b)
    setStorageType(nextType)
    setTestResult(null)
    mountForm.setFieldsValue({
      name: b.name,
      type: nextType,
      endpoint: b.endpoint,
      access_key: b.access_key,
      secret_key: '',
      bucket_name: b.bucket_name,
      region: b.region,
      use_ssl: b.use_ssl,
      public_domain: b.public_domain,
      local_path: b.local_path,
      is_default: b.is_default,
    })
    setMountDrawerOpen(true)
  }

  const applyPreset = (preset: CloudProviderPreset) => {
    mountForm.setFieldsValue({
      name: preset.name,
      endpoint: preset.endpoint,
      region: preset.region,
      use_ssl: preset.useSSL,
    })
  }

  // Pre-test S3 connection
  const handleTestMountConfig = async () => {
    try {
      const values = await mountForm.validateFields()
      setTestingConfigLoading(true)
      setTestResult(null)
      const res = await testBucketConfig(values)
      if (res.connected) {
        setTestResult({ ok: true, msg: '连通性测试通过！该 S3 存储可正常读写与挂载。' })
        messageApi.success('S3 连接测试成功')
      } else {
        setTestResult({ ok: false, msg: '无法连接到该 S3 端点，请核对 Endpoint、Bucket 或密钥' })
        messageApi.error('连接失败')
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || String(err)
      setTestResult({ ok: false, msg: `测试连接失败：${msg}` })
      messageApi.error(`连接失败：${msg}`)
    } finally {
      setTestingConfigLoading(false)
    }
  }

  // Mutations
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
    onSuccess: async (data) => {
      messageApi.success(editingBucket ? '存储节点配置已更新' : 'S3 存储节点挂载成功')
      setBucketId(data.id)
      closeMountDrawer()
      await invalidateBuckets()
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || err?.message || String(err)
      messageApi.error(`保存失败：${msg}`)
    },
  })

  const deleteBucketMutation = useMutation({
    mutationFn: deleteBucket,
    onSuccess: async (_, deletedId) => {
      messageApi.success('存储挂载已解除')
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
      if (res.connected) messageApi.success('节点连通性正常 ')
      else messageApi.error('连接失败，请检查 S3 服务或网络 ')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || String(err)
      messageApi.error(`测试异常：${msg}`)
    },
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
      messageApi.success('文件已上传并入库')
      setFileList([])
      setUploadDrawerOpen(false)
      await invalidateFiles()
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || String(err)
      messageApi.error(`上传失败：${msg}`)
    },
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
      messageApi.success('存储元数据已重新扫描刷新')
      await invalidateFiles()
    },
    onError: (err) => messageApi.error(String(err)),
  })

  // Smart upload file selection
  const handleFileDrop = (nextList: UploadFile[]) => {
    setFileList(nextList)
    if (nextList.length > 0) {
      const lower = (nextList[0].name || '').toLowerCase()
      if (lower.endsWith('.vib')) {
        setUploadType('driver')
      } else if (lower.includes('depot') && lower.endsWith('.zip')) {
        setUploadType('depot')
      } else if (lower.endsWith('.iso')) {
        setUploadType(categoryTab === 'iso' ? 'iso' : 'depot')
      }
      const match = lower.match(/(6\.5|6\.7|7\.0|8\.0|9\.0)/)
      if (match) setUploadVersion(match[1])
    }
  }

  const columns: ColumnsType<FileMetadata> = [
    {
      title: '资产名称与路径',
      key: 'name',
      render: (_, file) => (
        <div className="table-cell-stack">
          <Space size={6} wrap>
            <Typography.Text strong>{assetTitle(file)}</Typography.Text>
            {file.driver_version && <Tag style={{ marginInlineEnd: 0 }}>v{file.driver_version}</Tag>}
          </Space>
          <Typography.Text className="mono table-path" type="secondary" copyable ellipsis style={{ maxWidth: 460, fontSize: 11 }}>
            {file.path}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '适用版本',
      dataIndex: 'esxi_version',
      width: 100,
      render: (v) => (v ? <Tag color="geekblue">ESXi {v}</Tag> : <Tag>通用</Tag>),
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 110,
      render: (v) => <span className="mono tabular-nums">{compactSize(v)}</span>,
    },
    {
      title: '缓存就绪',
      key: 'cache',
      width: 110,
      render: (_, file) => (
        <Tag color={cacheStatusColor(file, selectedBucket)}>{cacheStatusText(file, selectedBucket)}</Tag>
      ),
    },
    {
      title: '修改时间',
      dataIndex: 'last_modified',
      width: 165,
      render: (v) => <span className="tabular-nums" style={{ fontSize: 12, color: '#64748b' }}>{formatDate(v || '')}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_, file) => {
        const canUseAsBase = file.type === 'depot' || (file.type === 'iso' && !file.path.toLowerCase().startsWith('output/'))
        return (
          <Space size={4} wrap>
            {canUseAsBase && (
              <Tooltip title="一键带入构建流水线">
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
              <Tooltip title="复制 S3 公网直链">
                <Button
                  size="small"
                  icon={<LinkOutlined />}
                  onClick={() => {
                    const url = buildPublicObjectUrl(selectedBucket.public_domain, file.path || '')
                    if (url) {
                      navigator.clipboard.writeText(url)
                      messageApi.success('已复制 S3 公网下载直链')
                    }
                  }}
                />
              </Tooltip>
            )}

            <Tooltip title="重命名">
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setRenaming(file)
                  renameForm.setFieldsValue({ new_name: fileName(file) })
                }}
              />
            </Tooltip>

            <Popconfirm
              title="确认从存储中删除该文件？"
              onConfirm={() => deleteFileMutation.mutate(file.id)}
              okText="删除"
              cancelText="取消"
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  const filesLoading = depotsQuery.isLoading || driversQuery.isLoading || isoQuery.isLoading

  return (
    <PageContainer
      title="存储与挂载管理"
      subTitle="支持本地磁盘目录与 S3 / MinIO 对象存储多盘挂载，自由在各盘中管理基础镜像、驱动与构建产出"
      extra={[
        <Button key="mount-local" icon={<HddOutlined />} onClick={openMountLocal}>
          挂载本地目录
        </Button>,
        <Button key="mount-s3" type="primary" icon={<CloudServerOutlined />} onClick={openMountS3}>
          挂载 S3 对象存储
        </Button>,
        <Button key="to-pipeline" icon={<RocketOutlined />} onClick={() => go('/build')}>
          前往构建流水线
        </Button>,
      ]}
    >
      {contextHolder}

      <div className="storage-management-layout">
        {/* ========================================================
            TOP SECTION: MOUNTED DRIVE CARDS (挂载盘卡片组)
            ======================================================== */}
        <section className="mounted-drives-section" aria-label="挂载存储盘列表">
          <div className="section-head-title">
            <Space size={6}>
              <DatabaseOutlined style={{ color: '#2563eb' }} />
              <strong>当前挂载存储盘 ({buckets.length})</strong>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              点击卡片切换当前操作盘，支持本地目录直通与各主流 S3 云对象存储
            </Typography.Text>
          </div>

          <div className="drive-cards-strip">
            {buckets.map((b) => {
              const active = b.id === selectedBucketId
              const isLocal = bucketType(b) === 'local'
              return (
                <div
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  className={`drive-card ${active ? 'drive-card-active' : ''}`}
                  onClick={() => setBucketId(b.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setBucketId(b.id)}
                >
                  <div className="drive-card-top">
                    <div className="drive-icon-box">
                      {isLocal ? <HddOutlined /> : <CloudServerOutlined />}
                    </div>
                    <div className="drive-titles">
                      <strong className="drive-name" title={b.name}>{b.name}</strong>
                      <span className="drive-type-label">
                        {isLocal ? '本地存储直通' : 'S3 / MinIO 兼容'}
                      </span>
                    </div>
                    <div className="drive-badges">
                      {b.is_default && (
                        <Tag color="success" className="mini-tag">
                          默认
                        </Tag>
                      )}
                      <Tag color={isLocal ? 'purple' : 'blue'} className="mini-tag">
                        {isLocal ? 'LOCAL' : 'S3'}
                      </Tag>
                    </div>
                  </div>

                  <div className="drive-card-meta">
                    <Typography.Text className="mono drive-location-text" ellipsis={{ tooltip: bucketLocation(b) }}>
                      {bucketLocation(b)}
                    </Typography.Text>
                  </div>

                  <div className="drive-card-actions" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="连通性测活">
                      <Button
                        size="small"
                        type="text"
                        icon={<ApiOutlined />}
                        loading={testingNodeId === b.id}
                        onClick={() => testConnectionMutation.mutate(b.id)}
                      >
                        测速
                      </Button>
                    </Tooltip>
                    {!b.is_default && (
                      <Tooltip title="设为默认存储">
                        <Button
                          size="small"
                          type="text"
                          icon={<StarOutlined />}
                          onClick={() => setDefaultMutation.mutate(b.id)}
                        >
                          默认
                        </Button>
                      </Tooltip>
                    )}
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEditMount(b)}>
                      配置
                    </Button>
                    {!b.is_default && (
                      <Popconfirm
                        title="解除此存储盘挂载？"
                        description="仅解除在系统中的挂载关联，不会删除磁盘或对象存储上的真实文件。"
                        onConfirm={() => deleteBucketMutation.mutate(b.id)}
                        okText="解除"
                        cancelText="取消"
                      >
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Quick Add S3 Card */}
            <div className="drive-card drive-card-add" onClick={openMountS3}>
              <PlusOutlined style={{ fontSize: 24, color: '#2563eb' }} />
              <strong>挂载新 S3 存储</strong>
              <span>MinIO / AWS / R2 / OSS</span>
            </div>
          </div>
        </section>

        {/* ========================================================
            BOTTOM SECTION: FILE REPOSITORY IN ACTIVE DRIVE (盘内文件管理)
            ======================================================== */}
        <section className="drive-assets-section" aria-label="存储盘资产文件库">
          <Card
            bordered
            title={
              selectedBucket ? (
                <Space size={10} wrap align="center">
                  <Badge status="processing" />
                  <Typography.Text strong style={{ fontSize: 15 }}>
                    盘内资产：{selectedBucket.name}
                  </Typography.Text>
                  <Tag color={selectedBucket.type === 'local' ? 'purple' : 'blue'}>
                    {bucketLocation(selectedBucket)}
                  </Tag>
                  <Tag color="cyan">基础源 {depots.length}</Tag>
                  <Tag color="blue">驱动 {drivers.length}</Tag>
                  <Tag color="purple">产物 {isos.length}</Tag>
                </Space>
              ) : (
                '请选择存储挂载盘'
              )
            }
            extra={
              <Space size={8} wrap>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={refreshMutation.isPending}
                  onClick={() => refreshMutation.mutate()}
                >
                  刷新元数据
                </Button>
                <Button
                  type="primary"
                  size="small"
                  icon={<CloudUploadOutlined />}
                  onClick={() => {
                    setUploadType(categoryTab)
                    setUploadDrawerOpen(true)
                  }}
                >
                  上传资产入库
                </Button>
              </Space>
            }
          >
            {/* Asset Category Segmented Switcher & Search Bar */}
            <div className="asset-top-filter-bar">
              <Segmented<AssetCategoryTab>
                value={categoryTab}
                onChange={setCategoryTab}
                options={[
                  { value: 'depot', label: `基础镜像源 (${depots.length})` },
                  { value: 'driver', label: `社区驱动包 (${drivers.length})` },
                  { value: 'iso', label: `构建产出 ISO (${isos.length})` },
                ]}
              />

              <Space size={10} wrap>
                <Select
                  style={{ width: 120 }}
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
                  placeholder="搜索文件名、驱动名..."
                  style={{ width: 220 }}
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                />
              </Space>
            </div>

            {/* Quick Drop Area Inside Table Header */}
            <div className="quick-drag-banner">
              <Upload.Dragger
                multiple={false}
                maxCount={1}
                accept=".iso,.zip,.vib"
                beforeUpload={() => false}
                fileList={fileList}
                onChange={({ fileList: next }) => handleFileDrop(next)}
                className="mini-dragger"
              >
                <p className="ant-upload-drag-icon" style={{ margin: '2px 0' }}>
                  <InboxOutlined style={{ fontSize: 24, color: '#2563eb' }} />
                </p>
                <p className="ant-upload-text" style={{ fontSize: 12, margin: '2px 0' }}>
                  拖拽 <strong>.iso / .zip / .vib</strong> 文件到此直接上传到「{selectedBucket?.name}」盘
                </p>
              </Upload.Dragger>
              {fileList.length > 0 && (
                <div className="file-ready-submit-bar">
                  <Space size={10}>
                    <span>已选待传：<strong>{fileList[0].name}</strong> ({compactSize(fileList[0].size)})</span>
                    <Button
                      type="primary"
                      size="small"
                      icon={<CloudUploadOutlined />}
                      loading={uploadMutation.isPending}
                      onClick={() => uploadMutation.mutate()}
                    >
                      开始上传
                    </Button>
                    <Button size="small" onClick={() => setFileList([])}>取消</Button>
                  </Space>
                </div>
              )}
            </div>

            {/* Assets Table */}
            <Table
              size="middle"
              rowKey="id"
              columns={columns}
              dataSource={currentCategoryFiles}
              loading={filesLoading}
              pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'] }}
              scroll={{ x: 880 }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="当前目录下暂无文件，请通过上方拖拽或右上角上传按钮存入文件"
                  />
                ),
              }}
            />
          </Card>
        </section>
      </div>

      {/* ========================================================
          S3 / LOCAL STORAGE MOUNT DRAWER (S3 挂载接口向导)
          ======================================================== */}
      <Drawer
        title={
          <Space size={8}>
            {storageType === 'local' ? <HddOutlined /> : <CloudServerOutlined style={{ color: '#2563eb' }} />}
            <span>{editingBucket ? `配置存储挂载 · ${editingBucket.name}` : storageType === 'local' ? '挂载本地目录' : '挂载 S3 对象存储'}</span>
          </Space>
        }
        open={mountDrawerOpen}
        onClose={closeMountDrawer}
        width={480}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={closeMountDrawer}>取消</Button>
            <Button
              type="primary"
              icon={<CheckCircleFilled />}
              loading={saveBucketMutation.isPending}
              onClick={() => mountForm.submit()}
            >
              {editingBucket ? '保存修改' : '确认挂载'}
            </Button>
          </Space>
        }
      >
        <Form
          form={mountForm}
          layout="vertical"
          initialValues={defaultBucketPayload}
          onFinish={(values) => saveBucketMutation.mutate(values)}
        >
          {/* Storage Type Toggle */}
          <Form.Item name="type" label="存储类型" style={{ marginBottom: 12 }}>
            <Segmented
              block
              value={storageType}
              onChange={(val) => {
                setStorageType(val as 's3' | 'local')
                setTestResult(null)
              }}
              options={[
                { value: 's3', label: 'S3 / MinIO 对象存储' },
                { value: 'local', label: '容器本地目录挂载' },
              ]}
            />
          </Form.Item>

          {/* S3 Presets Fast Filler */}
          {storageType === 's3' && (
            <div className="s3-preset-bar">
              <span className="preset-label">厂商快捷模板：</span>
              <div className="preset-pills">
                {S3_PRESETS.map((p) => (
                  <Tag
                    key={p.key}
                    color="blue"
                    className="preset-tag"
                    onClick={() => applyPreset(p)}
                  >
                    {p.label}
                  </Tag>
                ))}
              </div>
            </div>
          )}

          <Form.Item name="name" label="存储挂载名称 (别名)" rules={[{ required: true, message: '请输入存储节点名称' }]}>
            <Input placeholder="例如：MinIO-Cluster 或 Local-Storage" />
          </Form.Item>

          {storageType === 'local' ? (
            <Form.Item
              name="local_path"
              label="容器内本地挂载路径"
              rules={[{ required: true, message: '请输入本地路径' }]}
              extra="容器内读写真实路径，默认为 /data/storage"
            >
              <Input className="mono" placeholder="/data/storage" />
            </Form.Item>
          ) : (
            <>
              <Form.Item
                name="endpoint"
                label="S3 Endpoint 端点地址"
                rules={[{ required: true, message: '请输入 S3 端点' }]}
                extra="填写 IP:端口 或 域名（不要加 http:// 和 bucket 名）"
              >
                <Input className="mono" placeholder="192.168.0.10:9000 或 s3.amazonaws.com" />
              </Form.Item>

              <Form.Item
                name="bucket_name"
                label="Bucket 桶名称"
                rules={[{ required: true, message: '请输入 Bucket 名' }]}
              >
                <Input className="mono" placeholder="esxi-assets" />
              </Form.Item>

              <div className="form-grid-2">
                <Form.Item
                  name="access_key"
                  label="Access Key ID"
                  rules={[{ required: true, message: '请输入 Access Key' }]}
                >
                  <Input className="mono" placeholder="AKIA..." />
                </Form.Item>

                <Form.Item
                  name="region"
                  label="Region 区域"
                  extra="AWS填写区域代码，MinIO可填 us-east-1"
                >
                  <Input className="mono" placeholder="us-east-1" />
                </Form.Item>
              </div>

              <Form.Item
                name="secret_key"
                label="Secret Access Key"
                rules={[{ required: !editingBucket, message: '请输入 Secret Key' }]}
                extra={editingBucket ? '留空表示保持原有密钥不变' : undefined}
              >
                <Input.Password placeholder="Secret Access Key" />
              </Form.Item>

              <Form.Item
                name="public_domain"
                label="S3 公网下载直链域名 (可选)"
                extra="配置后可在文件库和流水线产出一键复制公网下载直链"
              >
                <Input className="mono" placeholder="https://download.yourdomain.com" />
              </Form.Item>

              <Form.Item name="use_ssl" label="启用 HTTPS (SSL)" valuePropName="checked" style={{ marginBottom: 12 }}>
                <Switch />
              </Form.Item>

              {/* Pre-mount Test Connection Button */}
              <div className="test-mount-panel">
                <Button
                  block
                  icon={<ApiOutlined />}
                  loading={testingConfigLoading}
                  onClick={handleTestMountConfig}
                >
                  测试 S3 连通性 (挂载前检验)
                </Button>
                {testResult && (
                  <Alert
                    style={{ marginTop: 8 }}
                    type={testResult.ok ? 'success' : 'error'}
                    showIcon
                    message={testResult.msg}
                  />
                )}
              </div>
            </>
          )}

          <Form.Item name="is_default" label="设为默认存储挂载盘" valuePropName="checked" style={{ marginTop: 12 }}>
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>

      {/* Upload Asset Modal / Drawer */}
      <Drawer
        title="上传文件入库"
        open={uploadDrawerOpen}
        onClose={() => setUploadDrawerOpen(false)}
        width={420}
        destroyOnClose
        extra={
          <Button
            type="primary"
            loading={uploadMutation.isPending}
            disabled={fileList.length === 0}
            onClick={() => uploadMutation.mutate()}
          >
            开始上传
          </Button>
        }
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
              1. 归类用途
            </Typography.Text>
            <Segmented<UploadType>
              block
              value={uploadType}
              onChange={setUploadType}
              options={[
                { value: 'depot', label: '基础源 (Depot/ISO)' },
                { value: 'driver', label: '驱动包 (VIB/ZIP)' },
                { value: 'iso', label: '普通 ISO' },
              ]}
            />
          </div>

          {uploadType !== 'iso' && (
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                2. 适用 ESXi 版本
              </Typography.Text>
              <Select
                style={{ width: '100%' }}
                value={uploadVersion}
                onChange={setUploadVersion}
                options={esxiVersions.map((v) => ({ value: v, label: `ESXi ${v}` }))}
              />
            </div>
          )}

          {uploadType === 'driver' && (
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                3. 驱动硬件分类
              </Typography.Text>
              <Select
                style={{ width: '100%' }}
                value={uploadCategory}
                onChange={setUploadCategory}
                options={driverCategories}
              />
            </div>
          )}

          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
              4. 选取本地文件
            </Typography.Text>
            <Upload.Dragger
              multiple={false}
              maxCount={1}
              accept=".iso,.zip,.vib"
              beforeUpload={() => false}
              fileList={fileList}
              onChange={({ fileList: next }) => handleFileDrop(next)}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined style={{ fontSize: 32, color: '#2563eb' }} />
              </p>
              <p className="ant-upload-text">点击或将文件拖拽到此处</p>
            </Upload.Dragger>
          </div>
        </Space>
      </Drawer>

      {/* Rename File Modal */}
      <Modal
        title="重命名存储文件"
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
          <Form.Item name="new_name" label="新文件名" rules={[{ required: true, message: '请输入新文件名' }]}>
            <Input placeholder="输入新文件名" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  )
}
