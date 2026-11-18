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
  ThunderboltOutlined,
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
  archiveFileToS3,
  archiveOutputsToS3,
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
import { resolveDepotMeta, resolveDriverMeta } from '../utils/driverMetadata'

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
  { value: 'modded', label: '魔改驱动 (ESXi 8+ 解锁版)' },
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
  const s3Buckets = useMemo(
    () => buckets.filter((b) => bucketType(b) !== 'local'),
    [buckets]
  )
  const defaultS3Bucket = useMemo(
    () => s3Buckets.find((b) => b.is_default) ?? s3Buckets[0],
    [s3Buckets]
  )
  const isSelectedLocalBucket = Boolean(selectedBucket && bucketType(selectedBucket) === 'local')

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
      if (!matchVersion || !matchKind) return false
      if (!kw) return true
      const dMeta = item.type === 'driver' ? resolveDriverMeta(item) : null
      const pMeta = item.type !== 'driver' ? resolveDepotMeta(item) : null
      return (
        item.path.toLowerCase().includes(kw) ||
        (item.driver_name && item.driver_name.toLowerCase().includes(kw)) ||
        (item.driver_description && item.driver_description.toLowerCase().includes(kw)) ||
        (dMeta &&
          (dMeta.zhName.toLowerCase().includes(kw) ||
            dMeta.moduleCode.toLowerCase().includes(kw) ||
            dMeta.subtitle.toLowerCase().includes(kw))) ||
        (pMeta &&
          (pMeta.zhName.toLowerCase().includes(kw) || pMeta.subtitle.toLowerCase().includes(kw)))
      )
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

  const archiveSingleFileMutation = useMutation({
    mutationFn: (id: number) => archiveFileToS3(id, defaultS3Bucket?.id),
    onSuccess: async (res) => {
      messageApi.success(
        `已转存至 S3「${res.target_bucket_name}」并清理本地镜像（释放 ${compactSize(res.freed_bytes)}）`
      )
      await queryClient.invalidateQueries({ queryKey: ['all-files'] })
      await queryClient.invalidateQueries({ queryKey: ['build-isos'] })
      await queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || err?.message || String(err)
      messageApi.error(`转存 S3 失败：${msg}`)
    },
  })

  const archiveAllOutputsMutation = useMutation({
    mutationFn: () => archiveOutputsToS3(selectedBucketId, defaultS3Bucket?.id),
    onSuccess: async (res) => {
      messageApi.success(
        `已将 ${res.transferred_count} 个生成镜像转存至 S3「${res.target_bucket_name}」并清理本地文件（释放 ${compactSize(res.freed_bytes)}）`
      )
      await queryClient.invalidateQueries({ queryKey: ['all-files'] })
      await queryClient.invalidateQueries({ queryKey: ['build-isos'] })
      await queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || err?.message || String(err)
      messageApi.error(`批量转存 S3 失败：${msg}`)
    },
  })

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

  const kindFilterOptions = useMemo(() => {
    if (assetTab === 'driver') {
      return [
        { value: 'all', label: '全部驱动' },
        { value: 'community', label: '社区驱动' },
        { value: 'modded', label: '魔改驱动' },
        { value: 'raid', label: '阵列卡' },
        { value: 'network', label: '网卡' },
        { value: 'storage', label: '存储/HBA' },
        { value: 'oem-addon', label: '品牌 Addon' },
      ]
    }
    if (assetTab === 'depot' || assetTab === 'iso') {
      return [
        { value: 'all', label: '全部来源' },
        { value: 'official', label: '官方原版' },
        { value: 'official-patch', label: '官方离线/补丁' },
        { value: 'oem', label: '品牌定制 (Dell/H3C/浪潮)' },
      ]
    }
    return []
  }, [assetTab])

  const columns: ColumnsType<FileMetadata> = [
    {
      title: assetTab === 'driver' ? '驱动名称与适用硬件' : '镜像 / 离线包说明',
      key: 'name',
      render: (_, file) => {
        if (file.type === 'driver') {
          const meta = resolveDriverMeta(file)
          return (
            <div className="apple-asset-cell">
              <div className="apple-asset-line1">
                <Tag
                  color={meta.categoryColor}
                  style={{ marginInlineEnd: 0, fontWeight: 500, borderRadius: 999, flexShrink: 0, fontSize: 11, paddingInline: 6 }}
                >
                  {meta.categoryLabel}
                </Tag>
                <span className="apple-asset-title" title={meta.zhName}>
                  {meta.zhName}
                </span>
                {meta.moduleCode && (
                  <Tooltip title={`存储路径：${file.path}`}>
                    <span className="apple-module-code">{meta.moduleCode}</span>
                  </Tooltip>
                )}
              </div>
              <div className="apple-asset-sub">
                <span className="apple-asset-sub-text" title={meta.subtitle}>
                  {meta.subtitle}
                </span>
              </div>
            </div>
          )
        }

        const depotMeta = resolveDepotMeta(file)
        return (
          <div className="apple-asset-cell">
            <div className="apple-asset-line1">
              <Tag
                color={depotMeta.badgeColor}
                style={{ marginInlineEnd: 0, fontWeight: 500, borderRadius: 999, flexShrink: 0, fontSize: 11, paddingInline: 6 }}
              >
                {depotMeta.badgeLabel}
              </Tag>
              <span className="apple-asset-title" title={depotMeta.zhName}>
                {depotMeta.zhName}
              </span>
            </div>
            <div className="apple-asset-sub">
              <span className="apple-asset-sub-text" title={depotMeta.subtitle}>
                {depotMeta.subtitle}
              </span>
              {!isBuildOutput(file) && (
                <Tooltip title={`存储路径：${file.path}`}>
                  <span className="apple-asset-file-hint">{fileName(file)}</span>
                </Tooltip>
              )}
            </div>
          </div>
        )
      },
    },
    ...(assetTab === 'driver'
      ? ([
          {
            title: '驱动版本',
            key: 'clean_ver',
            width: 112,
            render: (_: unknown, file: FileMetadata) => {
              const ver = cleanDisplayVersion(file)
              return (
                <span className="apple-module-code" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {ver || '-'}
                </span>
              )
            },
          },
        ] as ColumnsType<FileMetadata>)
      : []),
    {
      title: '适用系统',
      dataIndex: 'esxi_version',
      width: 82,
      render: (v) =>
        v ? (
          <Tag color="geekblue" style={{ borderRadius: 999, marginInlineEnd: 0, fontSize: 11, paddingInline: 6 }}>
            ESXi {v}
          </Tag>
        ) : (
          <Tag color="default" style={{ borderRadius: 999, marginInlineEnd: 0, fontSize: 11, paddingInline: 6 }}>
            未标注
          </Tag>
        ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 82,
      render: (v) => (
        <span className="tabular-nums" style={{ fontSize: 12, color: '#475569', whiteSpace: 'nowrap' }}>
          {compactSize(v)}
        </span>
      ),
    },
    {
      title: '状态',
      key: 'cache',
      width: 78,
      render: (_, file) => (
        <Tag
          color={cacheStatusColor(file, selectedBucket)}
          style={{ borderRadius: 999, marginInlineEnd: 0, fontSize: 11, paddingInline: 6 }}
        >
          {cacheStatusText(file, selectedBucket)}
        </Tag>
      ),
    },
    {
      title: '修改时间',
      dataIndex: 'last_modified',
      width: 126,
      render: (v) => (
        <span className="tabular-nums" style={{ fontSize: 11.5, color: '#64748b', whiteSpace: 'nowrap' }}>
          {formatDate(v || '')}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: assetTab === 'depot' || assetTab === 'iso' || assetTab === 'output' ? 256 : 174,
      render: (_, file) => {
        const canUseAsBase =
          file.type === 'depot' || (file.type === 'iso' && !isBuildOutput(file))
        // 品牌整包已内置驱动：不进驱动注入流水线。ZIP 走「转 ISO」，ISO 直接下载。
        const isOem = canUseAsBase && fileCategoryMeta(file).kind === 'oem'
        const isOemIso = isOem && file.path.toLowerCase().endsWith('.iso')
        const canArchiveOutputToS3 =
          isSelectedLocalBucket && Boolean(defaultS3Bucket) && isBuildOutput(file)
        return (
          <Space size={4} wrap={false}>
            {canArchiveOutputToS3 && (
              <Tooltip title={`转存至 S3「${defaultS3Bucket?.name}」并清理本地生成的镜像`}>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  style={{ borderRadius: 999, paddingInline: 8 }}
                  icon={<CloudUploadOutlined />}
                  loading={
                    archiveSingleFileMutation.isPending &&
                    archiveSingleFileMutation.variables === file.id
                  }
                  onClick={() => archiveSingleFileMutation.mutate(file.id)}
                >
                  转存 S3
                </Button>
              </Tooltip>
            )}
            {canUseAsBase && !isOem && (
              <Tooltip title="带入构建流水线">
                <Button
                  size="small"
                  type="primary"
                  ghost
                  style={{ borderRadius: 999, paddingInline: 8 }}
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
            {isOem && !isOemIso && (
              <Tooltip title="品牌包已内置驱动，零注入直接封装为 ISO">
                <Button
                  size="small"
                  type="primary"
                  ghost
                  style={{ borderRadius: 999, paddingInline: 8 }}
                  icon={<ThunderboltOutlined />}
                  onClick={() => {
                    const params = new URLSearchParams({
                      mode: 'oem',
                      bucket: String(selectedBucketId),
                      file: file.path,
                      auto: '1',
                    })
                    if (file.esxi_version) params.set('version', file.esxi_version)
                    go(`/build?${params.toString()}`)
                  }}
                >
                  转 ISO
                </Button>
              </Tooltip>
            )}
            <Tooltip title={isOemIso ? '品牌 ISO 已内置驱动，下载即可装机' : '下载到本机'}>
              <Button
                size="small"
                type={isOemIso ? 'primary' : 'default'}
                ghost={isOemIso}
                style={isOemIso ? { borderRadius: 999, paddingInline: 8 } : { borderRadius: 6, paddingInline: 8 }}
                icon={<DownloadOutlined />}
                onClick={() => handleDownload(file)}
              >
                下载
              </Button>
            </Tooltip>
            <Tooltip title={selectedBucket?.public_domain ? '复制公网直链' : '复制存储路径'}>
              <Button
                size="small"
                style={{ borderRadius: 6 }}
                icon={<CopyOutlined />}
                onClick={async () => {
                  const targetText = selectedBucket?.public_domain
                    ? buildPublicObjectUrl(selectedBucket.public_domain, file.path || '')
                    : file.path
                  if (!targetText) return
                  const ok = await copyText(targetText)
                  if (ok) {
                    messageApi.success(selectedBucket?.public_domain ? '已复制公网直链' : '已复制文件路径')
                  } else {
                    messageApi.error('浏览器不允许访问剪贴板，请手动复制')
                  }
                }}
              />
            </Tooltip>
            <Tooltip title="重命名">
              <Button
                size="small"
                style={{ borderRadius: 6 }}
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
              <Button size="small" style={{ borderRadius: 6 }} danger icon={<DeleteOutlined />} />
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
            <Button size="small" icon={<HddOutlined />} onClick={openMountLocal}>
              挂载本地目录
            </Button>
            <Button size="small" type="primary" icon={<CloudServerOutlined />} onClick={openMountS3}>
              挂载 S3 对象存储
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
              <PlusOutlined style={{ fontSize: 18, color: '#2563eb' }} />
              <strong>挂载 S3 存储</strong>
              <span>MinIO / AWS / R2 / OSS</span>
            </div>
          </div>
        </section>

        <section className="drive-assets-section" aria-label="盘内文件">
          <Card
            bordered
            className="apple-storage-card"
            title={
              selectedBucket ? (
                <Space size={6} wrap align="center">
                  {bucketType(selectedBucket) === 'local' ? (
                    <HddOutlined style={{ color: '#7c3aed', fontSize: 14 }} />
                  ) : (
                    <CloudServerOutlined style={{ color: '#0071e3', fontSize: 14 }} />
                  )}
                  <Typography.Text strong style={{ fontSize: 13.5, color: '#0f172a' }}>
                    {selectedBucket.name}
                  </Typography.Text>
                  <Tag
                    color={selectedBucket.type === 'local' ? 'purple' : 'blue'}
                    style={{ borderRadius: 999, marginInlineEnd: 0, fontSize: 11, paddingInline: 7 }}
                  >
                    {bucketLocation(selectedBucket)}
                  </Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                    共 {allFiles.length} 个文件
                  </Typography.Text>
                </Space>
              ) : (
                '请选择存储盘'
              )
            }
            extra={
              <Space size={8} wrap>
                <Button
                  size="small"
                  style={{ borderRadius: 8 }}
                  icon={<ReloadOutlined />}
                  disabled={!selectedBucketId}
                  onClick={() => selectedBucketId && scanBucket(selectedBucketId)}
                >
                  重新扫描
                </Button>
                <Button
                  type="primary"
                  size="small"
                  style={{ borderRadius: 8, background: '#0071e3' }}
                  icon={<CloudUploadOutlined />}
                  onClick={openUpload}
                >
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
                style={{ marginBottom: 12 }}
                message="扫描未完成"
                description={`文件列表可能不完整：${scanWarning}`}
              />
            )}

            <div className="apple-filter-stack">
              {/* 第一行：主资产分类 Apple 分段胶囊 + 搜索框 */}
              <div className="apple-filter-row">
                <div className="apple-segmented-group" role="tablist" aria-label="资产分类">
                  {(
                    [
                      { value: 'depot', label: '基础离线包', count: groups.depot.length },
                      { value: 'driver', label: '扩展驱动', count: groups.driver.length },
                      { value: 'iso', label: '安装镜像 ISO', count: groups.iso.length },
                      { value: 'output', label: '构建产出', count: groups.output.length },
                    ] as Array<{ value: AssetTab; label: string; count: number }>
                  ).map((tab) => {
                    const isActive = assetTab === tab.value
                    return (
                      <button
                        key={tab.value}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={`apple-segmented-btn ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          setAssetTab(tab.value)
                          setKindFilter('all')
                        }}
                      >
                        <span>{tab.label}</span>
                        <span className="apple-count-badge">{tab.count}</span>
                      </button>
                    )
                  })}
                </div>

                <Input
                  allowClear
                  size="small"
                  prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                  placeholder="搜索名称 / 芯片型号 / 文件名..."
                  style={{ width: 228, borderRadius: 7 }}
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                />
              </div>

              {/* 第二行：上下文细分标签（与构建页第1/2步完全一致）+ ESXi 版本筛选胶囊 */}
              <div className="apple-filter-row">
                {kindFilterOptions.length > 0 ? (
                  <div className="apple-segmented-group" style={{ padding: 2 }}>
                    {kindFilterOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`apple-segmented-btn ${kindFilter === opt.value ? 'active' : ''}`}
                        style={{ padding: '2px 9px', fontSize: 11.5 }}
                        onClick={() => setKindFilter(opt.value)}
                      >
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div />
                )}

                <div className="apple-segmented-group" style={{ padding: 2 }}>
                  {[
                    { value: 'all', label: '全部版本' },
                    ...esxiVersions.map((v) => ({ value: v, label: `ESXi ${v}` })),
                    ...(unversionedCount > 0 ? [{ value: 'unknown', label: `未标注 (${unversionedCount})` }] : []),
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`apple-segmented-btn ${versionFilter === opt.value ? 'active' : ''}`}
                      style={{ padding: '2px 9px', fontSize: 11.5 }}
                      onClick={() => setVersionFilter(opt.value)}
                    >
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {isSelectedLocalBucket && assetTab === 'output' && groups.output.length > 0 && defaultS3Bucket && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 10, borderRadius: 8 }}
                message={
                  <span>
                    当前本地盘共有 <strong>{groups.output.length}</strong> 个生成的镜像（共占用{' '}
                    <strong>{compactSize(groups.output.reduce((acc, f) => acc + (f.size || 0), 0))}</strong>
                    ），可一键转存至 S3「<strong>{defaultS3Bucket.name}</strong>」并清理本地生成的镜像文件。
                  </span>
                }
                action={
                  <Popconfirm
                    title={`确认将 ${groups.output.length} 个生成镜像转存至 S3「${defaultS3Bucket.name}」并删除本地副本？`}
                    onConfirm={() => archiveAllOutputsMutation.mutate()}
                    okText="立即转存并清理"
                    cancelText="取消"
                  >
                    <Button
                      size="small"
                      type="primary"
                      icon={<CloudUploadOutlined />}
                      loading={archiveAllOutputsMutation.isPending}
                    >
                      一键转存 S3 并清理本地
                    </Button>
                  </Popconfirm>
                }
              />
            )}

            <div className="apple-table-region" tabIndex={0} role="region" aria-label="存储盘文件列表">
              <Table
                size="small"
                tableLayout="fixed"
                rowKey="id"
                columns={columns}
                dataSource={currentFiles}
                loading={filesQuery.isLoading}
                pagination={{ pageSize: 12, showSizeChanger: true, pageSizeOptions: ['12', '24', '50'], size: 'small' }}
                scroll={{ x: 900 }}
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={
                        filesQuery.isError
                          ? `文件加载失败：${String(filesQuery.error)}`
                          : '当前筛选条件下暂无文件'
                      }
                    >
                      <Button size="small" onClick={openUpload} icon={<CloudUploadOutlined />}>
                        上传文件
                      </Button>
                    </Empty>
                  ),
                }}
              />
            </div>
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
