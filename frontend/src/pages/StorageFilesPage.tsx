import {
  ApiOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  HddOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  SearchOutlined,
  StarOutlined,
} from '../components/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
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
import { useMemo, useRef, useState } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import {
  type BucketPayload,
  type BucketTestResult,
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
  downloadFile,
  listAllFiles,
  refreshFiles,
  renameFile,
  uploadFile,
} from '../api/files'
import { PageHeader } from '../components/PageHeader'
import type { FileMetadata, StorageBucket } from '../types'
import { buildPublicObjectUrl, formatDate } from '../utils'
import {
  assetTitle,
  assetTypeText,
  bucketLocation,
  bucketType,
  cacheStatusColor,
  cacheStatusText,
  cleanDisplayVersion,
  compactSize,
  copyText,
  esxiVersions,
  fileCategoryMeta,
  fileName,
  isBuildOutput,
} from './pipelineUtils'
import { resolveDriverMeta } from '../utils/driverMetadata'

type UploadType = 'depot' | 'driver' | 'iso'
type AssetTab = 'depot' | 'driver' | 'output' | 'iso'

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
  { value: 'community', label: '社区驱动 (软路由/小主机)' },
  { value: 'raid', label: 'RAID 阵列卡驱动' },
  { value: 'network', label: '服务器网卡驱动' },
  { value: 'storage', label: '存储/HBA 驱动' },
  { value: 'oem-addon', label: '品牌机 Addon 扩展包' },
  { value: 'other', label: '其他驱动' },
]

const S3_PRESETS = [
  { key: 'minio', label: 'MinIO', endpoint: '192.168.0.10:9000', region: 'us-east-1', useSSL: false },
  { key: 'aws', label: 'Amazon S3', endpoint: 's3.us-east-1.amazonaws.com', region: 'us-east-1', useSSL: true },
  { key: 'r2', label: 'Cloudflare R2', endpoint: '<account-id>.r2.cloudflarestorage.com', region: 'auto', useSSL: true },
  { key: 'aliyun', label: '阿里云 OSS', endpoint: 'oss-cn-hangzhou.aliyuncs.com', region: 'oss-cn-hangzhou', useSSL: true },
  { key: 'custom', label: '通用 S3 兼容', endpoint: '', region: 'us-east-1', useSSL: true },
]

/** 根据文件名推断用途；无法确定时返回 null，交给用户确认。 */
function detectUploadType(name: string): UploadType | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.vib')) return 'driver'
  if (lower.endsWith('.zip')) {
    if (/esxi|depot|offline[-_]?bundle/.test(lower)) return 'depot'
    if (/^(net|scsi|sata|nvme|raid|vmkusb)|-(nic|raid)/.test(lower)) return 'driver'
    return null
  }
  if (lower.endsWith('.iso')) return 'iso'
  return null
}

function detectVersion(name: string): string | null {
  const match = name.match(/(6\.5|6\.7|7\.0|8\.0|9\.0)/)
  return match ? match[1] : null
}

export default function StorageFilesPage() {
  const queryClient = useQueryClient()
  const [messageApi, contextHolder] = message.useMessage()
  const inRouter = useInRouterContext()
  const routerNavigate = inRouter ? useNavigate() : null
  const go = (path: string) => {
    if (routerNavigate) routerNavigate(path)
    else window.location.assign(path)
  }

  // 挂载抽屉
  const [mountForm] = Form.useForm<BucketPayload>()
  const [mountOpen, setMountOpen] = useState(false)
  const [editingBucket, setEditingBucket] = useState<StorageBucket | null>(null)
  const [storageType, setStorageType] = useState<'s3' | 'local'>('s3')
  const [testingConfig, setTestingConfig] = useState(false)
  const [testResult, setTestResult] = useState<BucketTestResult | null>(null)
  const [testingNodeId, setTestingNodeId] = useState<number | null>(null)
  const [scanWarning, setScanWarning] = useState<string | null>(null)

  // 当前盘与文件
  const [bucketId, setBucketId] = useState<number | undefined>()
  const [assetTab, setAssetTab] = useState<AssetTab>('depot')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [versionFilter, setVersionFilter] = useState<string>('all')
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [renaming, setRenaming] = useState<FileMetadata | null>(null)
  const [renameForm] = Form.useForm<{ new_name: string }>()

  // 上传：目标盘在打开抽屉时锁定
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadTarget, setUploadTarget] = useState<{ id: number; name: string } | null>(null)
  const [uploadType, setUploadType] = useState<UploadType>('depot')
  const [uploadVersion, setUploadVersion] = useState('8.0')
  const [uploadCategory, setUploadCategory] = useState('network')
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [uploadPercent, setUploadPercent] = useState(0)
  const [uploadRate, setUploadRate] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const lastTick = useRef<{ time: number; loaded: number }>({ time: 0, loaded: 0 })

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

  const filesQuery = useQuery({
    queryKey: ['all-files', selectedBucketId],
    queryFn: () => listAllFiles(selectedBucketId as number),
    enabled: Boolean(selectedBucketId),
  })
  const allFiles = filesQuery.data ?? []

  const groups = useMemo(
    () => ({
      depot: allFiles.filter((f) => !isBuildOutput(f) && f.type === 'depot'),
      driver: allFiles.filter((f) => f.type === 'driver'),
      output: allFiles.filter((f) => isBuildOutput(f)),
      iso: allFiles.filter((f) => f.type === 'iso' && !isBuildOutput(f)),
    }),
    [allFiles]
  )

  const currentFiles = useMemo(() => {
    const source = groups[assetTab]
    const kw = searchKeyword.trim().toLowerCase()
    return source.filter((item) => {
      const matchVersion =
        versionFilter === 'all'
          ? true
          : versionFilter === 'unknown'
            ? !item.esxi_version
            : item.esxi_version === versionFilter
      const matchKind = kindFilter === 'all' || fileCategoryMeta(item).kind === kindFilter
      const matchKw =
        !kw ||
        item.path.toLowerCase().includes(kw) ||
        (item.driver_name && item.driver_name.toLowerCase().includes(kw)) ||
        (item.driver_description && item.driver_description.toLowerCase().includes(kw))
      return matchVersion && matchKind && matchKw
    })
  }, [assetTab, groups, searchKeyword, versionFilter, kindFilter])

  const unversionedCount = useMemo(
    () => groups[assetTab].filter((f) => !f.esxi_version).length,
    [assetTab, groups]
  )

  const invalidateFiles = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['all-files', selectedBucketId] }),
      queryClient.invalidateQueries({ queryKey: ['build-depots'] }),
      queryClient.invalidateQueries({ queryKey: ['build-drivers'] }),
    ])
  }
  const invalidateBuckets = async () => {
    await queryClient.invalidateQueries({ queryKey: ['buckets'] })
  }

  /** 挂载/刷新后做一次完整扫描；失败时明确提示，不假装成功。 */
  const scanBucket = async (id: number) => {
    setScanWarning(null)
    try {
      await refreshFiles(id)
      await invalidateFiles()
      messageApi.success('存储扫描完成')
    } catch (err: any) {
      const msg = err?.response?.data?.error || String(err)
      setScanWarning(msg)
      messageApi.warning(`扫描失败，文件列表可能不完整：${msg}`)
    }
  }

  const closeMount = () => {
    setMountOpen(false)
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
      name: '',
      endpoint: '',
      region: 'us-east-1',
      use_ssl: false,
    })
    setMountOpen(true)
  }

  const openMountLocal = () => {
    setEditingBucket(null)
    setStorageType('local')
    setTestResult(null)
    mountForm.setFieldsValue({
      ...defaultBucketPayload,
      type: 'local',
      name: '',
      local_path: '/data/storage',
      use_ssl: true,
    })
    setMountOpen(true)
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
    setMountOpen(true)
  }

  const applyPreset = (preset: (typeof S3_PRESETS)[number]) => {
    setTestResult(null)
    mountForm.setFieldsValue({ endpoint: preset.endpoint, region: preset.region, use_ssl: preset.useSSL })
  }

  const handleTestMountConfig = async () => {
    try {
      const values = await mountForm.validateFields()
      setTestingConfig(true)
      setTestResult(null)
      // 传 id：后端会沿用已保存的密钥，避免“留空密钥”误判
      const res = await testBucketConfig({ ...values, id: editingBucket?.id })
      setTestResult(res)
      if (res.connected) messageApi.success('端点可达，已确认可列举')
      else messageApi.error('连接失败，请检查端点与密钥')
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || String(err)
      setTestResult({ connected: false, message: msg })
      messageApi.error(`连接失败：${msg}`)
    } finally {
      setTestingConfig(false)
    }
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
    onSuccess: async (data) => {
      messageApi.success(editingBucket ? '存储节点已更新' : '存储节点已挂载')
      setBucketId(data.id)
      closeMount()
      await invalidateBuckets()
      await scanBucket(data.id)
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
    onError: (err: any) => messageApi.error(`解除失败：${err?.response?.data?.error || String(err)}`),
  })

  const setDefaultMutation = useMutation({
    mutationFn: setDefaultBucket,
    onSuccess: async () => {
      messageApi.success('已设为默认存储节点')
      await invalidateBuckets()
    },
    onError: (err: any) => messageApi.error(String(err)),
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
      if (res.connected) messageApi.success('连接正常：可访问且可列举')
      else messageApi.error('连接失败')
    },
    onError: (err: any) => messageApi.error(`检查失败：${err?.response?.data?.error || String(err)}`),
  })

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadTarget || fileList.length === 0) throw new Error('未选择目标存储盘或文件')
      const rawFile = (fileList[0].originFileObj ?? fileList[0]) as unknown as File
      abortRef.current = new AbortController()
      lastTick.current = { time: Date.now(), loaded: 0 }
      setUploadPercent(0)
      setUploadRate('')
      return uploadFile(
        uploadTarget.id,
        uploadType,
        rawFile,
        uploadType === 'iso' ? undefined : uploadVersion,
        uploadType === 'driver' ? uploadCategory : undefined,
        (percent, loaded, total) => {
          setUploadPercent(percent)
          const now = Date.now()
          const dt = (now - lastTick.current.time) / 1000
          if (dt > 0.4) {
            const bytes = loaded - lastTick.current.loaded
            setUploadRate(`${compactSize(Math.round(bytes / dt))}/s · ${compactSize(loaded)}/${compactSize(total)}`)
            lastTick.current = { time: now, loaded }
          }
        },
        abortRef.current.signal
      )
    },
    onSuccess: async () => {
      messageApi.success('上传完成')
      setFileList([])
      setUploadPercent(0)
      setUploadRate('')
      setUploadOpen(false)
      await invalidateFiles()
    },
    onError: (err: any) => {
      const cancelled = err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED'
      if (cancelled) messageApi.info('已取消上传（服务端可能已写入部分数据，请刷新确认）')
      else messageApi.error(`上传失败：${err?.response?.data?.error || String(err)}`)
      setUploadPercent(0)
      setUploadRate('')
    },
  })

  const deleteFileMutation = useMutation({
    mutationFn: (id: number) => deleteFile(id),
    onSuccess: async () => {
      messageApi.success('文件已删除')
      await invalidateFiles()
    },
    onError: (err: any) => messageApi.error(`删除失败：${err?.response?.data?.error || String(err)}`),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => renameFile(id, name),
    onSuccess: async () => {
      messageApi.success('重命名成功')
      setRenaming(null)
      renameForm.resetFields()
      await invalidateFiles()
    },
    onError: (err: any) => messageApi.error(`重命名失败：${err?.response?.data?.error || String(err)}`),
  })

  const handleDownload = async (file: FileMetadata) => {
    try {
      await downloadFile(file.id, fileName(file))
    } catch (err: any) {
      messageApi.error(`下载失败：${err?.response?.data?.error || String(err)}`)
    }
  }

  const openUpload = () => {
    if (!selectedBucket) {
      messageApi.warning('请先选择一个存储盘')
      return
    }
    setUploadTarget({ id: selectedBucket.id, name: selectedBucket.name })
    setUploadType(assetTab === 'driver' ? 'driver' : assetTab === 'iso' ? 'iso' : 'depot')
    setUploadVersion('8.0')
    setFileList([])
    setUploadPercent(0)
    setUploadRate('')
    setUploadOpen(true)
  }

  /** 选文件后按文件名推断用途/版本，推断不出就保留用户当前选择并提示需确认。 */
  const pickFiles = (next: UploadFile[]) => {
    setFileList(next)
    setUploadPercent(0)
    if (next.length === 0) return
    const name = next[0].name || ''
    const detectedType = detectUploadType(name)
    if (detectedType) setUploadType(detectedType)
    const detectedVersion = detectVersion(name)
    if (detectedVersion) setUploadVersion(detectedVersion)
    if (!detectedType) {
      messageApi.warning('未能从文件名判断用途，请在上方手动确认后上传')
    }
  }

  const columns: ColumnsType<FileMetadata> = [
    {
      title: '文件',
      key: 'name',
      render: (_, file) => {
        const cleanVer = cleanDisplayVersion(file)
        const driverMeta = file.type === 'driver' ? resolveDriverMeta(file) : null
        return (
          <div className="table-cell-stack">
            <Space size={6} wrap align="center">
              <Typography.Text strong style={{ fontSize: 13 }}>
                {assetTitle(file)}
              </Typography.Text>
              {cleanVer && <Tag style={{ marginInlineEnd: 0 }}>v{cleanVer}</Tag>}
              {driverMeta?.hardwareChip && (
                <Tag color="cyan" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                  {driverMeta.hardwareChip}
                </Tag>
              )}
              <Tag color={fileCategoryMeta(file).color}>{fileCategoryMeta(file).label}</Tag>
            </Space>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <Typography.Text
                className="mono table-path"
                type="secondary"
                copyable
                ellipsis
                style={{ maxWidth: 440, fontSize: 11 }}
              >
                {file.path}
              </Typography.Text>
              {driverMeta?.summary && (
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  · {driverMeta.summary}
                </Typography.Text>
              )}
            </div>
          </div>
        )
      },
    },
    {
      title: '适用版本',
      dataIndex: 'esxi_version',
      width: 100,
      render: (v) =>
        v ? <Tag color="geekblue">ESXi {v}</Tag> : <Tag color="default">未标注</Tag>,
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 105,
      render: (v) => <span className="mono tabular-nums">{compactSize(v)}</span>,
    },
    {
      title: '缓存',
      key: 'cache',
      width: 105,
      render: (_, file) => (
        <Tag color={cacheStatusColor(file, selectedBucket)}>{cacheStatusText(file, selectedBucket)}</Tag>
      ),
    },
    {
      title: '修改时间',
      dataIndex: 'last_modified',
      width: 158,
      render: (v) => (
        <span className="tabular-nums" style={{ fontSize: 12, color: '#64748b' }}>
          {formatDate(v || '')}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 250,
      render: (_, file) => {
        const canUseAsBase =
          file.type === 'depot' || (file.type === 'iso' && !isBuildOutput(file))
        return (
          <Space size={4} wrap>
            <Tooltip title="下载到本机">
              <Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(file)}>
                下载
              </Button>
            </Tooltip>
            {canUseAsBase && (
              <Tooltip title="带入构建流水线">
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
              <Tooltip title="复制公网直链">
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={async () => {
                    const url = buildPublicObjectUrl(selectedBucket.public_domain, file.path || '')
                    if (!url) return
                    const ok = await copyText(url)
                    if (ok) messageApi.success('已复制公网直链')
                    else messageApi.error('浏览器不允许访问剪贴板，请手动复制')
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
              title="确认删除该文件？"
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

  const selectedFile = fileList[0]
  const uploadReady = Boolean(uploadTarget) && fileList.length > 0 && !uploadMutation.isPending

  return (
    <div className="page-shell">
      <PageHeader
        title="存储与挂载"
        subTitle="本地目录与 S3 / MinIO 多盘挂载，按基础源、驱动、产出分类管理"
        extra={
          <>
            <Button icon={<HddOutlined />} onClick={openMountLocal}>
              挂载本地目录
            </Button>
            <Button type="primary" icon={<CloudServerOutlined />} onClick={openMountS3}>
              挂载 S3 对象存储
            </Button>
            <Button icon={<RocketOutlined />} onClick={() => go('/build')}>
              构建流水线
            </Button>
          </>
        }
      />
      {contextHolder}

      <div className="storage-management-layout">
        <section className="mounted-drives-section" aria-label="已挂载存储盘">
          <div className="section-head-title">
            <Space size={6}>
              <DatabaseOutlined style={{ color: '#2563eb' }} />
              <strong>存储盘（{buckets.length}）</strong>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              点击切换当前盘。本地盘路径是容器内路径，需要先在 Docker 里映射宿主机目录。
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
                    <div className="drive-icon-box">{isLocal ? <HddOutlined /> : <CloudServerOutlined />}</div>
                    <div className="drive-titles">
                      <strong className="drive-name" title={b.name}>
                        {b.name}
                      </strong>
                      <span className="drive-type-label">{isLocal ? '容器本地目录' : 'S3 / MinIO'}</span>
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
                    <Tooltip title="检查端点连通性与列举权限">
                      <Button
                        size="small"
                        type="text"
                        icon={<ApiOutlined />}
                        loading={testingNodeId === b.id}
                        onClick={() => testConnectionMutation.mutate(b.id)}
                      >
                        检查连接
                      </Button>
                    </Tooltip>
                    {!b.is_default && (
                      <Button size="small" type="text" icon={<StarOutlined />} onClick={() => setDefaultMutation.mutate(b.id)}>
                        设为默认
                      </Button>
                    )}
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEditMount(b)}>
                      配置
                    </Button>
                    {!b.is_default && (
                      <Popconfirm
                        title="解除该存储挂载？"
                        description="只解除系统中的挂载记录，不会删除磁盘或对象存储上的真实文件。"
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

            <div className="drive-card drive-card-add" onClick={openMountS3}>
              <PlusOutlined style={{ fontSize: 22, color: '#2563eb' }} />
              <strong>挂载 S3 存储</strong>
              <span>MinIO / AWS / R2 / OSS</span>
            </div>
          </div>
        </section>

        <section className="drive-assets-section" aria-label="盘内文件">
          <Card
            bordered
            title={
              selectedBucket ? (
                <Space size={8} wrap align="center">
                  <Typography.Text strong style={{ fontSize: 15 }}>
                    {selectedBucket.name}
                  </Typography.Text>
                  <Tag color={selectedBucket.type === 'local' ? 'purple' : 'blue'}>
                    {bucketLocation(selectedBucket)}
                  </Tag>
                  <Tag>基础源 {groups.depot.length}</Tag>
                  <Tag>驱动 {groups.driver.length}</Tag>
                  <Tag>产出 {groups.output.length}</Tag>
                  <Tag>ISO {groups.iso.length}</Tag>
                </Space>
              ) : (
                '请选择存储盘'
              )
            }
            extra={
              <Space size={8} wrap>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  disabled={!selectedBucketId}
                  onClick={() => selectedBucketId && scanBucket(selectedBucketId)}
                >
                  重新扫描
                </Button>
                <Button type="primary" size="small" icon={<CloudUploadOutlined />} onClick={openUpload}>
                  上传文件
                </Button>
              </Space>
            }
          >
            {scanWarning && (
              <Alert
                type="warning"
                showIcon
                closable
                style={{ marginBottom: 10 }}
                message="扫描未完成"
                description={`文件列表可能不完整：${scanWarning}`}
              />
            )}

            <div className="asset-top-filter-bar">
              <Segmented<AssetTab>
                value={assetTab}
                onChange={setAssetTab}
                options={[
                  { value: 'depot', label: `基础源 ${groups.depot.length}` },
                  { value: 'driver', label: `驱动 ${groups.driver.length}` },
                  { value: 'output', label: `构建产出 ${groups.output.length}` },
                  { value: 'iso', label: `普通 ISO ${groups.iso.length}` },
                ]}
              />
              <Space size={8} wrap>
                <Select
                  style={{ width: 140 }}
                  value={kindFilter}
                  onChange={setKindFilter}
                  options={[
                    { value: 'all', label: '全部品牌/分类' },
                    { value: 'official', label: '官方原版 ISO' },
                    { value: 'official-patch', label: '官方升级补丁包' },
                    { value: 'oem', label: '品牌定制 (Dell/H3C/浪潮)' },
                    { value: 'community', label: '社区驱动' },
                    { value: 'raid', label: '阵列卡驱动' },
                    { value: 'network', label: '网卡驱动' },
                    { value: 'storage', label: '存储/HBA' },
                    { value: 'oem-addon', label: '品牌 Addon' },
                  ]}
                />
                <Select
                  style={{ width: 132 }}
                  value={versionFilter}
                  onChange={setVersionFilter}
                  options={[
                    { value: 'all', label: '全部版本' },
                    ...esxiVersions.map((v) => ({ value: v, label: `ESXi ${v}` })),
                    { value: 'unknown', label: '未标注版本' },
                  ]}
                />
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="搜索文件名、驱动名"
                  style={{ width: 210 }}
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                />
              </Space>
            </div>

            {versionFilter !== 'all' && versionFilter !== 'unknown' && unversionedCount > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                另有 {unversionedCount} 个文件未标注 ESXi 版本，选择「未标注版本」可查看。
              </Typography.Text>
            )}

            <Table
              size="middle"
              rowKey="id"
              columns={columns}
              dataSource={currentFiles}
              loading={filesQuery.isLoading}
              pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'] }}
              scroll={{ x: 900 }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      filesQuery.isError
                        ? `文件加载失败：${String(filesQuery.error)}`
                        : '该分类暂无文件'
                    }
                  >
                    <Button size="small" onClick={openUpload} icon={<CloudUploadOutlined />}>
                      上传文件
                    </Button>
                  </Empty>
                ),
              }}
            />
          </Card>
        </section>
      </div>

      {/* 挂载抽屉 */}
      <Drawer
        title={
          <Space size={8}>
            {storageType === 'local' ? <HddOutlined /> : <CloudServerOutlined style={{ color: '#2563eb' }} />}
            <span>
              {editingBucket ? `配置存储 · ${editingBucket.name}` : storageType === 'local' ? '挂载本地目录' : '挂载 S3 对象存储'}
            </span>
          </Space>
        }
        open={mountOpen}
        onClose={closeMount}
        width={480}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={closeMount}>取消</Button>
            <Button
              type="primary"
              icon={<CheckCircleFilled />}
              loading={saveBucketMutation.isPending}
              onClick={() => mountForm.submit()}
            >
              {editingBucket ? '保存' : '挂载'}
            </Button>
          </Space>
        }
      >
        <Form
          form={mountForm}
          layout="vertical"
          initialValues={defaultBucketPayload}
          onFinish={(values) => saveBucketMutation.mutate(values)}
          onValuesChange={() => setTestResult(null)}
        >
          <Form.Item name="type" label="存储类型" style={{ marginBottom: 12 }}>
            <Segmented
              block
              value={storageType}
              onChange={(val) => {
                setStorageType(val as 's3' | 'local')
                setTestResult(null)
              }}
              options={[
                { value: 's3', label: 'S3 / MinIO' },
                { value: 'local', label: '容器本地目录' },
              ]}
            />
          </Form.Item>

          {storageType === 's3' && (
            <div className="s3-preset-bar">
              <span className="preset-label">厂商模板</span>
              <div className="preset-pills">
                {S3_PRESETS.map((p) => (
                  <Tag key={p.key} color="blue" className="preset-tag" onClick={() => applyPreset(p)}>
                    {p.label}
                  </Tag>
                ))}
              </div>
            </div>
          )}

          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如 MinIO-Cluster" />
          </Form.Item>

          {storageType === 'local' ? (
            <Form.Item
              name="local_path"
              label="容器内路径"
              rules={[{ required: true, message: '请输入容器内路径' }]}
              extra="必须是容器内已存在且已映射的目录，例如 /data/storage；不会自动创建宿主机目录。"
            >
              <Input className="mono" placeholder="/data/storage" />
            </Form.Item>
          ) : (
            <>
              <Form.Item
                name="endpoint"
                label="Endpoint"
                rules={[{ required: true, message: '请输入端点' }]}
                extra="只填主机与端口，不要带 http:// 和桶名；存储桶不会被自动创建。"
              >
                <Input className="mono" placeholder="192.168.0.10:9000" />
              </Form.Item>
              <Form.Item name="bucket_name" label="Bucket" rules={[{ required: true, message: '请输入桶名' }]}>
                <Input className="mono" placeholder="esxi-assets" />
              </Form.Item>
              <div className="form-grid-2">
                <Form.Item name="access_key" label="Access Key" rules={[{ required: true, message: '请输入 Access Key' }]}>
                  <Input className="mono" placeholder="Access Key" />
                </Form.Item>
                <Form.Item name="region" label="Region">
                  <Input className="mono" placeholder="us-east-1" />
                </Form.Item>
              </div>
              <Form.Item
                name="secret_key"
                label="Secret Key"
                rules={[{ required: !editingBucket, message: '请输入 Secret Key' }]}
                extra={editingBucket ? '留空表示沿用已保存的密钥' : undefined}
              >
                <Input.Password placeholder="Secret Key" />
              </Form.Item>
              <Form.Item name="public_domain" label="公网域名（可选）" extra="用于生成产物公网直链">
                <Input className="mono" placeholder="https://download.example.com" />
              </Form.Item>
              <Form.Item name="use_ssl" label="使用 HTTPS" valuePropName="checked">
                <Switch />
              </Form.Item>

              <div className="test-mount-panel">
                <Button block icon={<ApiOutlined />} loading={testingConfig} onClick={handleTestMountConfig}>
                  测试连接
                </Button>
                {testResult && (
                  <Alert
                    style={{ marginTop: 8 }}
                    type={testResult.connected ? 'success' : 'error'}
                    showIcon
                    message={
                      testResult.connected
                        ? '端点可达，已确认可以列举对象（读写权限未验证）'
                        : `无法连接：${testResult.message || '请检查端点与密钥'}`
                    }
                  />
                )}
              </div>
            </>
          )}

          <Form.Item name="is_default" label="设为默认存储盘" valuePropName="checked" style={{ marginTop: 12 }}>
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>

      {/* 上传抽屉：目标盘在打开时锁定，提交前展示用途/版本确认 */}
      <Drawer
        title="上传文件"
        open={uploadOpen}
        onClose={() => {
          if (uploadMutation.isPending) abortRef.current?.abort()
          setUploadOpen(false)
        }}
        width={440}
        destroyOnClose
        extra={
          <Button
            type="primary"
            loading={uploadMutation.isPending}
            disabled={!uploadReady}
            onClick={() => uploadMutation.mutate()}
          >
            开始上传
          </Button>
        }
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message={`目标存储盘：${uploadTarget?.name ?? '未选择'}`}
            description="上传过程中切换存储盘不会影响本次目标。"
          />

          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
              1. 文件用途
            </Typography.Text>
            <Segmented<UploadType>
              block
              value={uploadType}
              onChange={setUploadType}
              options={[
                { value: 'depot', label: '基础源' },
                { value: 'driver', label: '驱动' },
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
                3. 驱动分类
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
              4. 选择文件
            </Typography.Text>
            <Upload.Dragger
              multiple={false}
              maxCount={1}
              accept=".iso,.zip,.vib"
              beforeUpload={() => false}
              fileList={fileList}
              onChange={({ fileList: next }) => pickFiles(next)}
              disabled={uploadMutation.isPending}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined style={{ fontSize: 30, color: '#2563eb' }} />
              </p>
              <p className="ant-upload-text">点击或拖拽文件到此</p>
              <p className="ant-upload-hint">支持 .iso / .zip / .vib</p>
            </Upload.Dragger>
          </div>

          {selectedFile && (
            <div className="upload-confirm-box">
              <div>
                <span className="upload-confirm-label">文件</span>
                <span>{selectedFile.name}</span>
              </div>
              <div>
                <span className="upload-confirm-label">大小</span>
                <span className="mono tabular-nums">{compactSize(selectedFile.size)}</span>
              </div>
              <div>
                <span className="upload-confirm-label">用途</span>
                <span>
                  {uploadType === 'depot' ? '基础源' : uploadType === 'driver' ? '驱动' : '普通 ISO'}
                </span>
              </div>
              {uploadType !== 'iso' && (
                <div>
                  <span className="upload-confirm-label">版本</span>
                  <span>ESXi {uploadVersion}</span>
                </div>
              )}
              {uploadType === 'driver' && (
                <div>
                  <span className="upload-confirm-label">分类</span>
                  <span>{driverCategories.find((c) => c.value === uploadCategory)?.label}</span>
                </div>
              )}
            </div>
          )}

          {uploadMutation.isPending && (
            <div>
              <Progress percent={uploadPercent} status="active" />
              <Space size={8} style={{ marginTop: 4 }}>
                <Typography.Text type="secondary" className="tabular-nums" style={{ fontSize: 12 }}>
                  {uploadRate || '准备中…'}
                </Typography.Text>
                <Button size="small" danger onClick={() => abortRef.current?.abort()}>
                  取消上传
                </Button>
              </Space>
            </div>
          )}
        </Space>
      </Drawer>

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
              renameMutation.mutate({ id: renaming.id, name: new_name.trim() })
            }
          }}
        >
          <Form.Item name="new_name" label="新文件名" rules={[{ required: true, message: '请输入文件名' }]}>
            <Input placeholder="文件名" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
