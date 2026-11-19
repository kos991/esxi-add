import {
  CheckCircleFilled,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleFilled,
  CloseOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  HddOutlined,
  ApiOutlined,
  LinkOutlined,
  SettingOutlined,
  DesktopOutlined,
  DiscOutlined,
  CpuOutlined,
  SlidersOutlined,
  InfoCircleOutlined,
} from '../components/icons'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Popconfirm,
  Progress,
  Radio,
  Space,
  Steps,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom'
import { listBuckets } from '../api/buckets'
import {
  archiveBuildToS3,
  createBuild,
  deleteBuild,
  getBuild,
  getBuildArtifactPresignedUrl,
  getBuildArtifactUrl,
  getBuildPreflight,
  listBuilds,
  startBuildPreflight,
} from '../api/builds'
import { downloadFile, getFilePresignedUrl, listDepots, listDrivers, listISOs } from '../api/files'
import { PageHeader } from '../components/PageHeader'
import { useWebSocket } from '../hooks/useWebSocket'
import type { BuildTask, FileMetadata } from '../types'
import { buildPublicObjectUrl, buildS3ObjectUrl, formatDate, parseDrivers } from '../utils'
import {
  BuildStatusTag,
  cacheStatusColor,
  cacheStatusText,
  compactSize,
  copyText,
  dedupeChineseLogs,
  esxiVersions,
  fileCategoryMeta,
  fileName,
  formatLogToChinese,
  isArchivingPhase,
  isBuildOutput,
  isIsoPath,
  OEM_BRANDS,
  oemBrandOf,
} from './pipelineUtils'
import { resolveDriverMeta, resolveDepotMeta } from '../utils/driverMetadata'

type DepotOption = {
  key: string
  bucketId: number
  bucketName: string
  bucketType: 'local' | 's3'
  file: FileMetadata
}

type LogViewMode = 'chinese' | 'raw'
type LogFilterType = 'all' | 'issues'
type BuildMode = 'custom' | 'oem'

/** 第 3 步的初始值；品牌镜像一键转 ISO 沿用引导选项与密码，但安装方式单独用交互式。 */
const DEFAULT_INSTALL_MODE: 'unattended' | 'interactive' = 'unattended'
/** 品牌服务器常见多块盘，一键转 ISO 默认交互式安装，由装机人手动选盘，避免误抹首块硬盘。 */
const OEM_INSTALL_MODE: 'unattended' | 'interactive' = 'interactive'
const DEFAULT_BOOT_OPTIONS = ['hybrid_cpu', 'osdata_8g']
const DEFAULT_ROOT_PASSWORD = 'niuniu'

function shortVersion(value?: string) {
  if (!value) return '-'
  const match = value.match(/(\d+\.\d+(?:\.\d+)?)/)
  return match ? match[1] : value
}

function depotKey(bucketId: number, file: FileMetadata) {
  return `${bucketId}:${file.id}:${file.path}`
}

/** 从来源路径推断实际会用的引擎，用于第 1 步直接告诉用户耗时量级。 */
function engineOf(path: string): { label: string; short: string; tag: string; color: 'iso' | 'depot' } {
  if (path.toLowerCase().endsWith('.iso')) {
    return { label: 'ISO → 原生引擎（约 5~10 秒）', short: '原生 · 约 10 秒', tag: '原生', color: 'iso' }
  }
  return { label: 'Depot → PowerCLI（约 1~2 分钟）', short: 'PowerCLI · 约 1 分钟', tag: 'PowerCLI', color: 'depot' }
}

export default function BuildPage() {
  const queryClient = useQueryClient()
  const [messageApi, contextHolder] = message.useMessage()
  const [form] = Form.useForm()
  const logTerminalRef = useRef<HTMLDivElement>(null)

  const inRouter = useInRouterContext()
  const routerLocation = inRouter ? useLocation() : null
  const routerNavigate = inRouter ? useNavigate() : null

  const searchParams = useMemo(() => {
    const raw = routerLocation ? routerLocation.search : window.location.search
    return new URLSearchParams(raw)
  }, [routerLocation])

  const go = (path: string) => {
    if (routerNavigate) routerNavigate(path)
    else window.location.assign(path)
  }

  // 构建方式：定制构建（官方源 + 驱动注入） / 品牌镜像直下（已内置驱动，直接下载或转 ISO）
  const [buildMode, setBuildMode] = useState<BuildMode>(() => (searchParams.get('mode') === 'oem' ? 'oem' : 'custom'))
  const [oemFocusPath, setOemFocusPath] = useState<string>(() => searchParams.get('file') || '')
  const [oemAutoStartPath, setOemAutoStartPath] = useState<string>(() =>
    searchParams.get('mode') === 'oem' && searchParams.get('auto') === '1' ? searchParams.get('file') || '' : ''
  )
  /** 品牌包 key → 本页提交的转换任务 ID */
  const [oemTasks, setOemTasks] = useState<Record<string, string>>({})

  // 配方
  const [step, setStep] = useState(1)
  const [version, setVersion] = useState<string>(() => searchParams.get('version') || '8.0')
  const [bucketId, setBucketId] = useState<number | undefined>(() => {
    const b = searchParams.get('bucket')
    return b ? Number(b) : undefined
  })
  const [depotPath, setDepotPath] = useState<string>(() => searchParams.get('depot') || '')
  const [driverPaths, setDriverPaths] = useState<string[]>([])
  const [installMode, setInstallMode] = useState<'unattended' | 'interactive'>(DEFAULT_INSTALL_MODE)
  const [sourceKindFilter, setSourceKindFilter] = useState<'all' | 'official' | 'official-patch'>('all')
  const [driverCategoryFilter, setDriverCategoryFilter] = useState<'all' | 'community' | 'modded' | 'raid' | 'network' | 'storage' | 'oem-addon'>('all')
  const [bootOptions, setBootOptions] = useState<string[]>(DEFAULT_BOOT_OPTIONS)
  const [driverSearch, setDriverSearch] = useState('')

  // 预检
  const [preflightId, setPreflightId] = useState<string | null>(null)
  const [preflightInputKey, setPreflightInputKey] = useState('')

  // 任务查看
  const [activeTaskId, setActiveTaskId] = useState<string | null>(() => searchParams.get('task'))
  const [submittedTaskId, setSubmittedTaskId] = useState<string | null>(null)
  const [logViewMode, setLogViewMode] = useState<LogViewMode>('chinese')
  const [logFilter, setLogFilter] = useState<LogFilterType>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false)

  useEffect(() => {
    const urlTask = searchParams.get('task')
    if (urlTask) setActiveTaskId(urlTask)
    const urlBucket = searchParams.get('bucket')
    const urlDepot = searchParams.get('depot')
    const urlVersion = searchParams.get('version')
    if (urlVersion) setVersion(urlVersion)
    if (urlBucket) setBucketId(Number(urlBucket))
    if (urlDepot) setDepotPath(urlDepot)
    const urlMode = searchParams.get('mode')
    const urlFile = searchParams.get('file')
    if (urlMode === 'oem' || urlMode === 'custom') setBuildMode(urlMode)
    if (urlFile) setOemFocusPath(urlFile)
    if (urlMode === 'oem' && urlFile && searchParams.get('auto') === '1') setOemAutoStartPath(urlFile)
  }, [searchParams])

  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const buckets = bucketsQuery.data ?? []
  const depotQueries = useQueries({
    queries: buckets.map((bucket) => ({
      queryKey: ['build-depots', bucket.id, version],
      queryFn: () => listDepots(bucket.id, version),
      enabled: Boolean(bucket.id),
    })),
  })
  const isoQueries = useQueries({
    queries: buckets.map((bucket) => ({
      queryKey: ['build-isos', bucket.id],
      queryFn: () => (listISOs ? listISOs(bucket.id) : Promise.resolve([])),
      enabled: Boolean(bucket.id),
    })),
  })

  const depotOptions = useMemo<DepotOption[]>(() => {
    const out: DepotOption[] = []
    const seen = new Set<string>()
    buckets.forEach((bucket, index) => {
      const bType = bucket.type === 'local' ? 'local' : 's3'
      const depots = depotQueries[index]?.data ?? []
      const isos = (isoQueries[index]?.data ?? []).filter(
        (file) => !isBuildOutput(file) && (!file.esxi_version || file.esxi_version === version)
      )
      for (const file of [...isos, ...depots]) {
        const key = depotKey(bucket.id, file)
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ key, bucketId: bucket.id, bucketName: bucket.name, bucketType: bType, file })
      }
    })
    return out
  }, [buckets, depotQueries, isoQueries, version])

  const selectedBucketId = bucketId ?? buckets.find((b) => b.is_default)?.id ?? buckets[0]?.id
  const selectedBucket = buckets.find((b) => b.id === selectedBucketId)
  const s3Buckets = useMemo(() => buckets.filter((b) => b.type !== 'local'), [buckets])
  const defaultS3Bucket = useMemo(
    () => s3Buckets.find((b) => b.is_default) ?? s3Buckets[0],
    [s3Buckets]
  )
  const [archiveToS3, setArchiveToS3] = useState(true)

  const driversQuery = useQuery({
    queryKey: ['build-drivers', selectedBucketId, version],
    queryFn: () => listDrivers(selectedBucketId as number, version),
    enabled: Boolean(selectedBucketId),
  })
  const drivers = driversQuery.data ?? []
  const sourcesLoading =
    bucketsQuery.isLoading ||
    depotQueries.some((q) => q.isLoading) ||
    isoQueries.some((q) => q.isLoading)
  // 品牌整包已内置驱动，不能作为定制构建的底包；只在「品牌镜像直下」里出现
  const officialOptions = useMemo(
    () => depotOptions.filter((item) => fileCategoryMeta(item.file).kind !== 'oem'),
    [depotOptions]
  )
  const oemOptions = useMemo(
    () => depotOptions.filter((item) => fileCategoryMeta(item.file).kind === 'oem'),
    [depotOptions]
  )
  const oemGroups = useMemo(
    () =>
      OEM_BRANDS.map((brand) => ({
        ...brand,
        items: oemOptions.filter((item) => oemBrandOf(item.file) === brand.key),
      })).filter((group) => group.items.length > 0),
    [oemOptions]
  )
  const selectedDepot = depotOptions.find(
    (item) => item.bucketId === selectedBucketId && item.file.path === depotPath
  )
  const isSelectedOem = Boolean(selectedDepot && fileCategoryMeta(selectedDepot.file).kind === 'oem')
  const filteredDepotOptions = useMemo(() => {
    const base =
      sourceKindFilter === 'all'
        ? officialOptions
        : officialOptions.filter((item) => fileCategoryMeta(item.file).kind === sourceKindFilter)
    if (selectedDepot && fileCategoryMeta(selectedDepot.file).kind === 'oem') {
      return [selectedDepot, ...base]
    }
    return base
  }, [officialOptions, sourceKindFilter, selectedDepot])

  const effectiveDriverPaths = useMemo(
    () => driverPaths.filter((p) => drivers.some((d) => d.path === p)),
    [driverPaths, drivers]
  )
  const selectedDrivers = useMemo(
    () => drivers.filter((file) => effectiveDriverPaths.includes(file.path)),
    [drivers, effectiveDriverPaths]
  )

  useEffect(() => {
    if (sourcesLoading) return
    if (!selectedDepot) {
      if (officialOptions.length > 0) {
        setBucketId(officialOptions[0].bucketId)
        setDepotPath(officialOptions[0].file.path)
      } else if (depotPath) {
        setDepotPath('')
      }
    }
  }, [sourcesLoading, officialOptions, depotPath, selectedDepot])

  const currentInputKey = `${selectedBucketId}|${depotPath}|${version}|${effectiveDriverPaths.join(',')}`
  const preflightQuery = useQuery({
    queryKey: ['build-preflight', preflightId],
    queryFn: () => getBuildPreflight(preflightId!),
    enabled: Boolean(preflightId),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1200 : false),
    refetchIntervalInBackground: false,
  })
  const preflightFresh = Boolean(preflightId) && preflightInputKey === currentInputKey

  const preflightMutation = useMutation({
    mutationFn: startBuildPreflight,
    onSuccess: (res) => {
      setPreflightId(res.id)
      setPreflightInputKey(currentInputKey)
    },
    onError: (err) => messageApi.error(String(err)),
  })

  const recentBuildsQuery = useQuery({
    queryKey: ['builds-recent'],
    queryFn: () => listBuilds(1, 30),
    refetchInterval: (query) => {
      const hasRunning = (query.state.data?.items ?? []).some(
        (t) => t.status === 'running' || t.status === 'pending'
      )
      return hasRunning ? 2500 : 12000
    },
    refetchIntervalInBackground: false,
  })
  const recentBuilds = recentBuildsQuery.data?.items ?? []

  const activeTaskQuery = useQuery({
    queryKey: ['build-active', activeTaskId],
    queryFn: () => getBuild(activeTaskId!),
    enabled: Boolean(activeTaskId),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' || query.state.data?.status === 'pending' ? 1500 : false,
    refetchIntervalInBackground: false,
  })
  const activeTask = activeTaskQuery.data ?? recentBuilds.find((t) => t.task_id === activeTaskId)
  const activeTaskBucket = useMemo(
    () => buckets.find((b) => b.id === activeTask?.storage_bucket_id),
    [buckets, activeTask?.storage_bucket_id]
  )
  const { logs: wsLogs, progress: wsProgress, state: wsState } = useWebSocket(activeTaskId ?? null)

  const isTaskRunning = activeTask?.status === 'running' || activeTask?.status === 'pending'
  const displayProgress = isTaskRunning
    ? Math.max(wsProgress || 0, activeTask?.progress || 0)
    : activeTask?.progress ?? 0

  const rawLogs = useMemo(() => {
    const fromTask = activeTask?.log_output ? activeTask.log_output.split('\n').filter(Boolean) : []
    if (wsLogs.length > 0 && activeTaskId === submittedTaskId) return wsLogs
    return fromTask
  }, [wsLogs, activeTask?.log_output, activeTaskId, submittedTaskId])

  const chineseLogs = useMemo(() => dedupeChineseLogs(rawLogs.map(formatLogToChinese)), [rawLogs])
  const filteredChineseLogs = useMemo(
    () =>
      logFilter === 'all'
        ? chineseLogs
        : chineseLogs.filter((i) => i.kind === 'error' || i.kind === 'warn'),
    [chineseLogs, logFilter]
  )
  const filteredRawLogs = useMemo(() => {
    if (logFilter === 'all') return rawLogs
    return rawLogs.filter((l) => /error|failed|failure|fatal|warn/i.test(l))
  }, [rawLogs, logFilter])

  useEffect(() => {
    if (autoScroll && logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight
    }
  }, [filteredChineseLogs, filteredRawLogs, autoScroll, activeTaskId])

  const createMutation = useMutation({
    mutationFn: createBuild,
    onSuccess: (task) => {
      setActiveTaskId(task.task_id)
      setSubmittedTaskId(task.task_id)
      setLogFilter('all')
      messageApi.success('流水线已启动，下方显示本次构建日志')
      queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
      window.setTimeout(
        () => document.getElementById('pipeline-output')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }),
        150
      )
    },
    onError: (err) => messageApi.error(`创建任务失败：${String(err)}`),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteBuild,
    onSuccess: (_, deletedId) => {
      messageApi.success('任务记录已删除')
      if (activeTaskId === deletedId) {
        setActiveTaskId(null)
        setSubmittedTaskId(null)
      }
      queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
    },
    onError: (err) => messageApi.error(`删除失败：${String(err)}`),
  })

  /** 品牌 Depot 一键转 ISO：零驱动 + 默认安装参数，复用同一个建任务接口。 */
  const oemConvertMutation = useMutation({
    mutationFn: (item: DepotOption) =>
      createBuild({
        bucket_id: item.bucketId,
        esxi_version: version,
        depot_path: item.file.path,
        driver_paths: [],
        root_password: DEFAULT_ROOT_PASSWORD,
        install_mode: OEM_INSTALL_MODE,
        boot_options: [...DEFAULT_BOOT_OPTIONS],
        ...(defaultS3Bucket
          ? {
              archive_to_s3: archiveToS3,
              ...(archiveToS3 ? { target_bucket_id: defaultS3Bucket.id } : {}),
            }
          : {}),
      }),
    onSuccess: (task, item) => {
      setOemTasks((prev) => ({ ...prev, [item.key]: task.task_id }))
      setActiveTaskId(task.task_id)
      setSubmittedTaskId(task.task_id)
      setLogFilter('all')
      messageApi.success('已开始转换为 ISO，进度见卡片，日志在下方')
      queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
    },
    onError: (err) => messageApi.error(`转换任务创建失败：${String(err)}`),
  })

  const archiveMutation = useMutation({
    mutationFn: (taskId: string) => archiveBuildToS3(taskId, defaultS3Bucket?.id),
    onMutate: () => {
      messageApi.open({
        key: 'archive-s3-loading',
        type: 'loading',
        content: '正在将产出镜像转存至 S3 对象存储并清理本地副本，请稍候…',
        duration: 0,
      })
    },
    onSuccess: (res) => {
      messageApi.destroy('archive-s3-loading')
      messageApi.success(
        `已转存至 S3「${res.target_bucket_name}」并清理本地生成的镜像${res.freed_bytes > 0 ? `（释放 ${compactSize(res.freed_bytes)}）` : ''}`
      )
      queryClient.invalidateQueries({ queryKey: ['build-active', res.task.task_id] })
      queryClient.invalidateQueries({ queryKey: ['builds-recent'] })
      queryClient.invalidateQueries({ queryKey: ['all-files'] })
      queryClient.invalidateQueries({ queryKey: ['build-isos'] })
    },
    onError: (err: any) => {
      messageApi.destroy('archive-s3-loading')
      const msg = err?.response?.data?.error || err?.message || String(err)
      messageApi.error(`转存 S3 失败：${msg}`)
    },
  })

  const replaceUrlWithout = (key: string) => {
    const params = new URLSearchParams(searchParams)
    if (!params.has(key)) return
    params.delete(key)
    const query = params.toString()
    const path = `${routerLocation?.pathname ?? window.location.pathname}${query ? `?${query}` : ''}`
    if (routerNavigate) routerNavigate(path, { replace: true })
    else window.history.replaceState(window.history.state, '', path)
  }

  // 存储页「转 ISO」深链：预选该品牌包并自动开始一次（之后从 URL 去掉 auto，刷新不会重复提交）
  useEffect(() => {
    if (!oemAutoStartPath || buildMode !== 'oem' || sourcesLoading) return
    const hit = oemOptions.find(
      (item) => item.file.path === oemAutoStartPath && (bucketId === undefined || item.bucketId === bucketId)
    )
    setOemAutoStartPath('')
    replaceUrlWithout('auto')
    if (hit && !isIsoPath(hit.file.path) && !oemTasks[hit.key]) {
      oemConvertMutation.mutate(hit)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oemAutoStartPath, buildMode, sourcesLoading, oemOptions, bucketId])

  useEffect(() => {
    if (buildMode !== 'oem' || !oemFocusPath || sourcesLoading) return
    window.setTimeout(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-oem-path]')).find(
        (el) => el.dataset.oemPath === oemFocusPath
      )
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    }, 150)
  }, [buildMode, oemFocusPath, sourcesLoading])

  const bucketPublicUrl = (bId: number, objectPath: string) => {
    const bucket = buckets.find((b) => b.id === bId)
    return bucket?.public_domain ? buildPublicObjectUrl(bucket.public_domain, objectPath) : undefined
  }

  const copyLink = async (text: string, okText: string) => {
    const ok = await copyText(text)
    if (ok) messageApi.success(okText)
    else messageApi.error('当前浏览器不允许访问剪贴板，请手动复制')
  }

  const downloadSource = async (item: DepotOption) => {
    try {
      const bucket = buckets.find((b) => b.id === item.bucketId)
      if (bucket && bucket.type !== 'local') {
        const res = await getFilePresignedUrl(item.file.id)
        if (res?.url) {
          window.open(res.url, '_blank', 'noopener,noreferrer')
          return
        }
      }
      await downloadFile(item.file.id, fileName(item.file))
    } catch (err: any) {
      messageApi.error(`下载失败：${err?.response?.data?.error || String(err)}`)
    }
  }

  const copySourceLink = async (item: DepotOption) => {
    const bucket = buckets.find((b) => b.id === item.bucketId)
    if (bucket && bucket.type !== 'local') {
      try {
        const res = await getFilePresignedUrl(item.file.id)
        if (res?.url) {
          return copyLink(res.url, '已复制 S3 签名下载链接（24 小时有效）')
        }
      } catch {
        // fallback to public or raw path
      }
    }
    const publicUrl = bucketPublicUrl(item.bucketId, item.file.path)
    return copyLink(publicUrl || item.file.path, publicUrl ? '已复制公网直链' : '已复制文件路径')
  }

  const resolveTaskS3Url = (task?: BuildTask): string | undefined => {
    if (!task?.output_iso) return undefined
    const taskBucket = buckets.find((b) => b.id === task.storage_bucket_id)
    if (taskBucket && taskBucket.type !== 'local') {
      return buildS3ObjectUrl(taskBucket, task.output_iso) || task.output_iso
    }
    if (!taskBucket && defaultS3Bucket) {
      return buildS3ObjectUrl(defaultS3Bucket, task.output_iso) || task.output_iso
    }
    return undefined
  }

  const copyArtifactLink = async (task: BuildTask) => {
    const taskBucket = buckets.find((b) => b.id === task.storage_bucket_id)
    const isS3Task = (taskBucket && taskBucket.type !== 'local') || (!taskBucket && Boolean(defaultS3Bucket))
    if (isS3Task) {
      try {
        const res = await getBuildArtifactPresignedUrl(task.task_id)
        if (res?.url) {
          return copyLink(res.url, '已复制 S3 签名下载链接（24 小时有效）')
        }
      } catch {
        // fallback to static URL if presign fails
      }
    }
    const s3Url = resolveTaskS3Url(task)
    const target = s3Url || task.output_iso || getBuildArtifactUrl(task.task_id)
    return copyLink(target, '已复制产出镜像 S3 地址')
  }

  const downloadTaskArtifact = async (task: BuildTask) => {
    try {
      const res = await getBuildArtifactPresignedUrl(task.task_id)
      if (res?.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer')
        return
      }
    } catch {
      // fallback to backend artifact stream endpoint
    }
    window.open(getBuildArtifactUrl(task.task_id), '_blank', 'noopener,noreferrer')
  }

  const isActiveTaskArchiving =
    isArchivingPhase(activeTask?.status, rawLogs) ||
    (archiveMutation.isPending && archiveMutation.variables === activeTask?.task_id)
  const activeTaskS3Url = resolveTaskS3Url(activeTask)

  const driverCategories = [
    { key: 'all', label: '全部' },
    { key: 'community', label: '社区驱动' },
    { key: 'modded', label: '魔改驱动' },
    { key: 'raid', label: '阵列卡' },
    { key: 'network', label: '网卡' },
    { key: 'storage', label: '存储/HBA' },
    { key: 'oem-addon', label: '品牌 Addon' },
  ]

  const categoryStats = useMemo(() => {
    const map: Record<string, { total: number; selected: number }> = {
      all: { total: drivers.length, selected: effectiveDriverPaths.length },
      community: { total: 0, selected: 0 },
      modded: { total: 0, selected: 0 },
      raid: { total: 0, selected: 0 },
      network: { total: 0, selected: 0 },
      storage: { total: 0, selected: 0 },
      'oem-addon': { total: 0, selected: 0 },
    }
    for (const d of drivers) {
      const kind = fileCategoryMeta(d).kind
      if (map[kind]) {
        map[kind].total += 1
        if (effectiveDriverPaths.includes(d.path)) {
          map[kind].selected += 1
        }
      }
    }
    return map
  }, [drivers, effectiveDriverPaths])

  const filteredDrivers = useMemo(() => {
    const kw = driverSearch.trim().toLowerCase()
    return drivers.filter((d) => {
      const catOk = driverCategoryFilter === 'all' || fileCategoryMeta(d).kind === driverCategoryFilter
      if (!catOk) return false
      if (!kw) return true
      const meta = resolveDriverMeta(d)
      return (
        d.path.toLowerCase().includes(kw) ||
        (d.driver_name && d.driver_name.toLowerCase().includes(kw)) ||
        (d.driver_description && d.driver_description.toLowerCase().includes(kw)) ||
        meta.zhName.toLowerCase().includes(kw) ||
        meta.moduleCode.toLowerCase().includes(kw) ||
        (meta.hardwareChip && meta.hardwareChip.toLowerCase().includes(kw)) ||
        meta.summary.toLowerCase().includes(kw)
      )
    })
  }, [drivers, driverSearch, driverCategoryFilter])

  const allDriversSelected =
    filteredDrivers.length > 0 && filteredDrivers.every((d) => effectiveDriverPaths.includes(d.path))

  const driverColumns: ColumnsType<FileMetadata> = [
    {
      title: '驱动名称与适用硬件',
      key: 'name',
      render: (_, file) => {
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
                <Tooltip title={`文件路径：${file.path}`}>
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
      },
    },
    {
      title: '版本',
      dataIndex: 'driver_version',
      width: 126,
      render: (_, file) => {
        const meta = resolveDriverMeta(file)
        const ver = meta.cleanVersion || shortVersion(file.driver_version)
        return (
          <span className="apple-module-code" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {ver || '-'}
          </span>
        )
      },
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 88,
      render: (v) => (
        <span style={{ fontSize: 12, color: '#475569', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {compactSize(v)}
        </span>
      ),
    },
    {
      title: '状态',
      key: 'flag',
      width: 84,
      render: (_, file) => {
        if (file.conflicts_with || file.depends_on) {
          return <Tag color="warning" style={{ borderRadius: 999, marginInlineEnd: 0, fontSize: 11, paddingInline: 6 }}>待确认</Tag>
        }
        if (file.cache_status === 'cached' || file.cached) {
          return <Tag color="success" style={{ borderRadius: 999, marginInlineEnd: 0, fontSize: 11, paddingInline: 6 }}>已就绪</Tag>
        }
        return <Tag color="processing" style={{ borderRadius: 999, marginInlineEnd: 0, fontSize: 11, paddingInline: 6 }}>可注入</Tag>
      },
    },
  ]

  const nowTimestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const formulaPlaceholder = `ESXi-${version}-custom-${nowTimestamp}.iso`

  const runPipeline = () => {
    if (!selectedDepot || !selectedBucketId) {
      messageApi.warning('请先在第 1 步选择基础镜像')
      setStep(1)
      return
    }
    form.validateFields().then((values) => {
      createMutation.mutate({
        bucket_id: selectedBucketId,
        esxi_version: version,
        depot_path: depotPath,
        driver_paths: effectiveDriverPaths,
        custom_iso_name: values.custom_iso_name ? values.custom_iso_name.trim() : undefined,
        root_password: values.root_password ? values.root_password.trim() : 'niuniu',
        install_mode: installMode,
        boot_options: bootOptions,
        ...(defaultS3Bucket
          ? {
              archive_to_s3: archiveToS3,
              ...(archiveToS3 ? { target_bucket_id: defaultS3Bucket.id } : {}),
            }
          : {}),
      })
    })
  }

  const remoteArtifactUrl =
    activeTask?.output_iso && activeTaskBucket?.public_domain
      ? buildPublicObjectUrl(activeTaskBucket.public_domain, activeTask.output_iso)
      : undefined

  const viewingHistory = Boolean(activeTaskId) && activeTaskId !== submittedTaskId

  const copyLogs = async () => {
    const text =
      logViewMode === 'chinese'
        ? filteredChineseLogs.map((l) => l.chinese).join('\n')
        : filteredRawLogs.join('\n')
    const ok = await copyText(text)
    if (ok) messageApi.success('已复制日志')
    else messageApi.error('当前浏览器不允许访问剪贴板，请手动选择文本复制')
  }

  const customName = Form.useWatch('custom_iso_name', form)
  const rootPwd = Form.useWatch('root_password', form)

  const stepItems = [
    {
      title: '基础镜像',
      content: '版本与安装源',
      icon: step > 1 ? <CheckCircleOutlined /> : <DiscOutlined />,
    },
    {
      title: '驱动注入',
      content: selectedDrivers.length > 0 ? `已选 ${selectedDrivers.length} 项` : '可选',
      icon: step > 2 ? <CheckCircleOutlined /> : <CpuOutlined />,
    },
    {
      title: '安装参数',
      content: '模式与命名',
      icon: step > 3 ? <CheckCircleOutlined /> : <SlidersOutlined />,
    },
    {
      title: '确认并运行',
      content: '核对后执行',
      icon: <PlayCircleOutlined />,
    },
  ]

  const canLeaveStep1 = Boolean(selectedDepot)

  const versionPicker = (
    <div className="field-block">
      <Typography.Text type="secondary" className="field-block-label" style={{ marginBottom: 4, display: 'block', fontSize: 12 }}>
        目标 ESXi 版本
      </Typography.Text>
      <div className="apple-segmented-group">
        {esxiVersions.map((v) => (
          <button
            key={v}
            type="button"
            className={`apple-segmented-btn ${version === v ? 'active' : ''}`}
            onClick={() => {
              setVersion(v)
              setDepotPath('')
              setDriverPaths([])
              setPreflightId(null)
            }}
          >
            <span>ESXi {v}</span>
          </button>
        ))}
      </div>
    </div>
  )

  const customizeOemSource = (item: DepotOption) => {
    setBucketId(item.bucketId)
    setDepotPath(item.file.path)
    setDriverPaths([])
    setPreflightId(null)
    setInstallMode(OEM_INSTALL_MODE)
    setBuildMode('custom')
    setStep(2)
  }

  const renderOemCard = (item: DepotOption) => {
    const catMeta = fileCategoryMeta(item.file)
    const depotMeta = resolveDepotMeta(item.file)
    const isIso = isIsoPath(item.file.path)
    const taskId = oemTasks[item.key]
    const task = taskId
      ? taskId === activeTaskId && activeTask
        ? activeTask
        : recentBuilds.find((t) => t.task_id === taskId)
      : undefined
    const taskRunning = Boolean(taskId) && (!task || task.status === 'running' || task.status === 'pending')
    const taskDone = task?.status === 'completed' && Boolean(task.output_iso)
    const taskFailed = task?.status === 'failed'
    const percent = taskId === activeTaskId ? displayProgress : task?.progress ?? 0
    const submitting = oemConvertMutation.isPending && oemConvertMutation.variables?.key === item.key

    return (
      <div
        key={item.key}
        data-oem-path={item.file.path}
        className={`apple-source-card apple-oem-card ${oemFocusPath === item.file.path ? 'selected' : ''}`}
      >
        <div className="apple-asset-cell">
          <div className="apple-asset-line1">
            <Tag color={catMeta.color} style={{ marginInlineEnd: 0, fontWeight: 500, borderRadius: 999, flexShrink: 0, fontSize: 11, paddingInline: 6 }}>
              {isIso ? 'ISO' : '离线包'}
            </Tag>
            <span className="apple-asset-title" title={depotMeta.zhName}>
              {depotMeta.zhName}
            </span>
          </div>
          <div className="apple-asset-sub">
            <span className="apple-asset-sub-text">
              {'ESXi ' + (item.file.esxi_version || version) + ' · ' + compactSize(item.file.size) + ' · ' + item.bucketName}
            </span>
          </div>
          <span className="apple-asset-file-hint oem-file-hint" title={item.file.path}>
            {fileName(item.file)}
          </span>
        </div>

        {taskId && !isIso && (
          <div className="oem-task-line">
            {taskRunning ? (
              <>
                <Progress percent={Math.round(percent)} size="small" status="active" style={{ flex: 1, margin: 0 }} />
                <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  {(taskId === activeTaskId
                    ? isActiveTaskArchiving
                    : isArchivingPhase(task?.status, task?.log_output?.split('\n')))
                    ? '正在转存至 S3…'
                    : '正在转换…'}
                </Typography.Text>
              </>
            ) : task ? (
              <>
                <BuildStatusTag status={task.status} />
                {taskDone && (
                  <Typography.Text
                    code
                    ellipsis={{ tooltip: resolveTaskS3Url(task) || task.output_iso }}
                    style={{ fontSize: 11, flex: 1, minWidth: 0 }}
                  >
                    {resolveTaskS3Url(task) || task.output_iso}
                  </Typography.Text>
                )}
                {taskFailed && task.error_message && (
                  <Typography.Text type="danger" ellipsis={{ tooltip: task.error_message }} style={{ fontSize: 11, flex: 1, minWidth: 0 }}>
                    {task.error_message}
                  </Typography.Text>
                )}
              </>
            ) : null}
            {taskId !== activeTaskId && (
              <Button size="small" type="link" style={{ padding: 0, height: 'auto', fontSize: 11 }} onClick={() => setActiveTaskId(taskId)}>
                看日志
              </Button>
            )}
          </div>
        )}

        <div className="oem-card-actions">
          {isIso ? (
            <>
              <Button size="small" type="primary" icon={<DownloadOutlined />} onClick={() => downloadSource(item)}>
                下载 ISO
              </Button>
              <Button size="small" icon={<SettingOutlined />} onClick={() => customizeOemSource(item)}>
                去定制
              </Button>
              <Button size="small" icon={<LinkOutlined />} onClick={() => copySourceLink(item)}>
                复制链接
              </Button>
            </>
          ) : taskDone && task ? (
            <>
              <Button
                size="small"
                type="primary"
                icon={<CopyOutlined />}
                onClick={() => copyArtifactLink(task)}
              >
                复制 S3 地址
              </Button>
              <Button size="small" icon={<SettingOutlined />} onClick={() => customizeOemSource(item)}>
                去定制
              </Button>
              <Button size="small" type="text" onClick={() => downloadSource(item)}>
                下载原包
              </Button>
            </>
          ) : (
            <>
              <Button
                size="small"
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={submitting}
                disabled={taskRunning}
                onClick={() => {
                  setOemFocusPath(item.file.path)
                  oemConvertMutation.mutate(item)
                }}
              >
                {taskFailed ? '重新转换' : '一键转 ISO'}
              </Button>
              <Button size="small" icon={<SettingOutlined />} onClick={() => customizeOemSource(item)}>
                去定制
              </Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadSource(item)}>
                下载原包
              </Button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="page-shell">
      {contextHolder}

      <PageHeader
        title="构建流水线"
        subTitle={buildMode === 'oem' ? '品牌镜像已内置驱动，直接下载、一键转 ISO 或进入定制' : '按步骤完成配置，最后确认后运行'}
        extra={
          <>
            <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistoryDrawerOpen(true)}>
              历史（{recentBuilds.length}）
            </Button>
            <Button size="small" icon={<CloudUploadOutlined />} onClick={() => go('/storage')}>
              存储
            </Button>
          </>
        }
      />

      {viewingHistory && (
        <Alert
          type="info"
          showIcon
          message={'正在查看历史任务 ' + activeTaskId}
          action={
            <Button size="small" disabled={!submittedTaskId} onClick={() => setActiveTaskId(submittedTaskId)}>
              回到本次
            </Button>
          }
        />
      )}

      <Card className="wizard-card">
        {(buildMode === 'oem' || step === 1) && (
          <div className="build-mode-row">
            <div className="apple-segmented-group" role="group" aria-label="构建方式">
              {([
                { value: 'custom', label: '定制构建' },
                { value: 'oem', label: '品牌镜像直下' },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={buildMode === opt.value}
                  className={`apple-segmented-btn ${buildMode === opt.value ? 'active' : ''}`}
                  onClick={() => {
                    if (opt.value === 'custom' && isSelectedOem) {
                      if (officialOptions.length > 0) {
                        setBucketId(officialOptions[0].bucketId)
                        setDepotPath(officialOptions[0].file.path)
                      } else {
                        setDepotPath('')
                      }
                      setInstallMode(DEFAULT_INSTALL_MODE)
                    }
                    setBuildMode(opt.value)
                    setStep(1)
                  }}
                >
                  <span>{opt.label}</span>
                  {opt.value === 'oem' && oemOptions.length > 0 && (
                    <span className="apple-count-badge">{oemOptions.length}</span>
                  )}
                </button>
              ))}
            </div>
            <Typography.Text type="secondary" className="build-mode-hint">
              {buildMode === 'custom'
                ? '官方原版 / 官方离线包 + 驱动注入，四步完成'
                : 'Dell / H3C / 浪潮 / HPE 原厂整包已内置驱动，无需注入，直接下载、一键转 ISO 或点「去定制」补充驱动'}
            </Typography.Text>
          </div>
        )}

        {buildMode === 'custom' && (
          <>
            <Steps
              size="small"
              current={step - 1}
              className="wizard-steps"
              onChange={(idx) => {
                const target = idx + 1
                if (target <= step || canLeaveStep1) setStep(target)
              }}
              items={stepItems.map((item, idx) => ({
                ...item,
                disabled: idx + 1 > step && !canLeaveStep1,
              }))}
            />
            <Divider style={{ margin: '12px 0 14px' }} />
          </>
        )}

        {buildMode === 'oem' && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {versionPicker}
            <div className="oem-notice">
              品牌整包已内置原厂驱动，日常装机直接「下载 ISO」或点「一键转 ISO」封装（交互式安装 · 大小核防紫屏 + 8GB 系统盘）；如需额外加塞网卡 / NVMe 社区驱动或修改安装参数，点「去定制」进入向导。
            </div>

            {sourcesLoading && oemGroups.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center' }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>正在加载品牌镜像…</Typography.Text>
              </div>
            ) : oemGroups.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={'暂无 ESXi ' + version + ' 的品牌镜像'}>
                <Button size="small" type="primary" onClick={() => go('/storage')}>
                  去存储上传
                </Button>
              </Empty>
            ) : (
              oemGroups.map((group) => (
                <div key={group.key} className="oem-group">
                  <div className="oem-group-title">
                    <span>{group.label}</span>
                    <span className="apple-count-badge">{group.items.length}</span>
                  </div>
                  <div className="apple-oem-grid">
                    {group.items.map((item) => renderOemCard(item))}
                  </div>
                </div>
              ))
            )}
          </Space>
        )}

        {buildMode === 'custom' && step === 1 && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {versionPicker}

            <div className="field-block">
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <Typography.Text type="secondary" className="field-block-label">
                  选择安装源
                </Typography.Text>
                <div className="apple-segmented-group" style={{ padding: 2 }}>
                  {[
                    { value: 'all', label: '全部 (' + officialOptions.length + ')' },
                    { value: 'official', label: '官方原版' },
                    { value: 'official-patch', label: '官方离线包/补丁' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`apple-segmented-btn ${sourceKindFilter === opt.value ? 'active' : ''}`}
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={() => setSourceKindFilter(opt.value as any)}
                    >
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {sourcesLoading && filteredDepotOptions.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center' }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>正在加载安装源…</Typography.Text>
                </div>
              ) : filteredDepotOptions.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={'暂无 ESXi ' + version + ' 的可用镜像源'}
                  style={{ marginTop: 8 }}
                >
                  <Space size={8}>
                    <Button size="small" type="primary" onClick={() => go('/storage')}>
                      去存储上传
                    </Button>
                    {oemOptions.length > 0 && (
                      <Button size="small" onClick={() => setBuildMode('oem')}>
                        改用品牌镜像直下（{oemOptions.length}）
                      </Button>
                    )}
                  </Space>
                </Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                  {filteredDepotOptions.map((item) => {
                    const catMeta = fileCategoryMeta(item.file)
                    const depotMeta = resolveDepotMeta(item.file)
                    const isSelected = (selectedDepot?.key ?? '') === item.key
                    return (
                      <div
                        key={item.key}
                        className={`apple-source-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setBucketId(item.bucketId)
                          setDepotPath(item.file.path)
                          setDriverPaths([])
                          setPreflightId(null)
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                            {isSelected ? (
                              <CheckCircleFilled style={{ color: '#0071e3', fontSize: 16 }} />
                            ) : (
                              <div
                                style={{
                                  width: 15,
                                  height: 15,
                                  borderRadius: '50%',
                                  border: '1.5px solid #cbd5e1',
                                  background: '#ffffff',
                                }}
                              />
                            )}
                          </div>

                          <div className="apple-asset-cell" style={{ flex: 1 }}>
                            <div className="apple-asset-line1">
                              <Tag color={catMeta.color} style={{ marginInlineEnd: 0, fontWeight: 500, borderRadius: 999, flexShrink: 0, fontSize: 11, paddingInline: 6 }}>
                                {depotMeta.badgeLabel || catMeta.label}
                              </Tag>
                              <span className="apple-asset-title" title={depotMeta.zhName}>
                                {depotMeta.zhName}
                              </span>
                            </div>

                            <div className="apple-asset-sub">
                              <span className="apple-asset-sub-text">
                                {(item.bucketType === 's3' ? 'S3 挂载' : '本地存储') +
                                  ' · ' +
                                  item.bucketName +
                                  ' · ' +
                                  compactSize(item.file.size) +
                                  (depotMeta.subtitle ? ` · ${depotMeta.subtitle}` : '')}
                              </span>
                            </div>
                          </div>
                        </div>

                        <span className="apple-asset-file-hint" title={item.file.path}>
                          {fileName(item.file)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {selectedDepot && (
              <Space wrap align="center">
                <Button
                  size="small"
                  icon={<SafetyCertificateOutlined />}
                  loading={preflightMutation.isPending}
                  onClick={() => {
                    if (!selectedBucketId || !depotPath) return
                    preflightMutation.mutate({
                      bucket_id: selectedBucketId,
                      depot_path: depotPath,
                      driver_paths: effectiveDriverPaths,
                    })
                  }}
                >
                  预检源文件
                </Button>
                {!preflightFresh && preflightId && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    参数已变更，需重新预检
                  </Typography.Text>
                )}
                {preflightFresh && preflightQuery.data && (
                  <Alert
                    type={
                      preflightQuery.data.status === 'ready'
                        ? 'success'
                        : preflightQuery.data.status === 'running'
                          ? 'info'
                          : 'warning'
                    }
                    showIcon
                    message={
                      preflightQuery.data.status === 'ready'
                        ? '源文件预检通过'
                        : preflightQuery.data.status === 'running'
                          ? '正在预检…'
                          : '预检未通过：' + (preflightQuery.data.message || preflightQuery.data.status)
                    }
                  />
                )}
              </Space>
            )}
          </Space>
        )}

        {buildMode === 'custom' && step === 2 && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {isSelectedOem && selectedDepot && (
              <Alert
                type="info"
                showIcon
                message={`当前以品牌包「${resolveDepotMeta(selectedDepot.file).zhName}」作为定制底包`}
                description="该品牌底包已内置原厂阵列卡/网卡驱动，此处仅需勾选额外补充的驱动（如 Realtek 网卡、USB 网卡、社区 NVMe 等），切勿重复勾选低于原厂版本的同名驱动。"
                action={
                  <Button
                    size="small"
                    onClick={() => {
                      setBuildMode('oem')
                      setOemFocusPath(selectedDepot.file.path)
                    }}
                  >
                    换品牌包
                  </Button>
                }
              />
            )}

            {/* 苹果风格分类选择分段控制器 */}
            <div className="apple-segmented-group" style={{ width: '100%', overflowX: 'auto', padding: 4 }}>
              {driverCategories.map((cat) => {
                const stats = categoryStats[cat.key] || { total: 0, selected: 0 }
                const isActive = driverCategoryFilter === cat.key
                return (
                  <button
                    key={cat.key}
                    type="button"
                    className={`apple-segmented-btn ${isActive ? 'active' : ''}`}
                    onClick={() => setDriverCategoryFilter(cat.key as any)}
                  >
                    <span>{cat.label}</span>
                    {stats.selected > 0 ? (
                      <span
                        style={{
                          background: isActive ? '#0071e3' : '#16a34a',
                          color: '#ffffff',
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 9999,
                          lineHeight: 1.2,
                        }}
                      >
                        已选 {stats.selected}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, opacity: 0.65 }}>
                        ({stats.total})
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* 搜索与快捷操作栏 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <Space wrap size={8}>
                <Input
                  allowClear
                  size="small"
                  prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                  placeholder="搜索驱动名称 / 芯片型号 / 厂商..."
                  value={driverSearch}
                  onChange={(e) => setDriverSearch(e.target.value)}
                  style={{ width: 236, borderRadius: 7 }}
                />
                <Button
                  size="small"
                  style={{ borderRadius: 6 }}
                  onClick={() => {
                    const paths = filteredDrivers.map((d) => d.path)
                    if (allDriversSelected) {
                      setDriverPaths(effectiveDriverPaths.filter((x) => !paths.includes(x)))
                    } else {
                      setDriverPaths(Array.from(new Set([...effectiveDriverPaths, ...paths])))
                    }
                  }}
                >
                  {allDriversSelected ? '取消全选当前' : '全选当前分类'}
                </Button>
                <Button
                  size="small"
                  type="text"
                  danger
                  disabled={effectiveDriverPaths.length === 0}
                  onClick={() => setDriverPaths([])}
                >
                  清空全部已选
                </Button>
              </Space>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                  当前分类：{filteredDrivers.length} 款 · 全局共选入
                </Typography.Text>
                <Tag color={selectedDrivers.length > 0 ? 'blue' : 'default'} style={{ borderRadius: 999, marginInlineEnd: 0, fontSize: 11, paddingInline: 6 }}>
                  {selectedDrivers.length} 个
                </Tag>
              </div>
            </div>

            {/* 驱动列表表格（整行可点击切换勾选） */}
            <div className="apple-table-region" tabIndex={0} role="region" aria-label="可扩展驱动列表">
              <Table
                size="small"
                tableLayout="fixed"
                rowKey="path"
                columns={driverColumns}
                dataSource={filteredDrivers}
                loading={driversQuery.isLoading}
                pagination={false}
                scroll={{ x: 620 }}
                rowSelection={{
                  selectedRowKeys: effectiveDriverPaths,
                  onChange: (keys) => setDriverPaths(keys as string[]),
                }}
                onRow={(record) => ({
                  onClick: (e) => {
                    const target = e.target as HTMLElement
                    if (
                      target.closest('.ant-typography-copy') ||
                      target.closest('.ant-table-selection-column') ||
                      target.closest('.ant-checkbox-wrapper') ||
                      target.tagName === 'INPUT'
                    ) {
                      return
                    }
                    setDriverPaths((prev) => {
                      const exists = prev.includes(record.path)
                      return exists ? prev.filter((p) => p !== record.path) : [...prev, record.path]
                    })
                  },
                  className: `apple-driver-table-row ${effectiveDriverPaths.includes(record.path) ? 'row-selected' : ''}`,
                })}
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={driversQuery.isError ? '驱动加载失败' : '当前分类暂无驱动（可直接进入下一步构建）'}
                    />
                  ),
                }}
              />
            </div>

            {/* 表格正下方的【本次构建待注入驱动】全景清单（解决多选看不清的问题） */}
            {selectedDrivers.length > 0 ? (
              <div
                style={{
                  background: '#ffffff',
                  border: '1.5px solid #bbf7d0',
                  borderRadius: 14,
                  padding: '14px 18px',
                  boxShadow: '0 4px 16px rgba(22, 163, 74, 0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <Space size={8}>
                    <CheckCircleFilled style={{ color: '#16a34a', fontSize: 16 }} />
                    <Typography.Text strong style={{ color: '#15803d', fontSize: 13.5 }}>
                      本次构建已勾选注入 {selectedDrivers.length} 个扩展组件
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      （跨分类多选均已保留 · 点击 ✕ 可单项剔除）
                    </Typography.Text>
                  </Space>
                  <Button
                    size="small"
                    type="link"
                    danger
                    style={{ padding: 0, height: 'auto', fontSize: 12 }}
                    onClick={() => setDriverPaths([])}
                  >
                    清空全部已选
                  </Button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {selectedDrivers.map((d) => {
                    const meta = resolveDriverMeta(d)
                    return (
                      <div
                        key={d.path}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '5px 11px',
                          borderRadius: 9999,
                          background: '#f8fafc',
                          border: '1px solid #cbd5e1',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <Tag color={meta.categoryColor} style={{ marginInlineEnd: 0, padding: '0 6px', borderRadius: 999, fontSize: 11 }}>
                          {meta.categoryLabel}
                        </Tag>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>
                          {meta.zhName}
                        </span>
                        {meta.moduleCode && (
                          <span className="apple-module-code">{meta.moduleCode}</span>
                        )}
                        <span
                          role="button"
                          aria-label={`移除 ${meta.zhName}`}
                          style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', padding: 2, marginLeft: 2 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setDriverPaths((prev) => prev.filter((p) => p !== d.path))
                          }}
                        >
                          <CloseCircleFilled style={{ color: '#94a3b8', fontSize: 15 }} />
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1.5px dashed #cbd5e1',
                  borderRadius: 12,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <InfoCircleOutlined style={{ color: '#64748b', fontSize: 14, flexShrink: 0 }} />
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  <strong>未勾选任何额外驱动</strong>：若官方镜像已原生支持您的硬件，可直接进入下一步构建纯净版 ISO。
                </Typography.Text>
              </div>
            )}
          </Space>
        )}

        {buildMode === 'custom' && step === 3 && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <Typography.Text type="secondary" className="field-block-label" style={{ marginBottom: 8, display: 'block' }}>
                选择安装部署模式
              </Typography.Text>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                <div
                  className={`apple-source-card ${installMode === 'unattended' ? 'selected' : ''}`}
                  onClick={() => setInstallMode('unattended')}
                  style={{ alignItems: 'flex-start', padding: '10px 14px' }}
                >
                  <div style={{ marginTop: 2, flexShrink: 0 }}>
                    {installMode === 'unattended' ? (
                      <CheckCircleFilled style={{ color: '#0071e3', fontSize: 16 }} />
                    ) : (
                      <div style={{ width: 15, height: 15, borderRadius: '50%', border: '1.5px solid #cbd5e1' }} />
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ThunderboltOutlined style={{ color: installMode === 'unattended' ? '#0071e3' : '#475569', fontSize: 14 }} />
                      <Typography.Text strong style={{ fontSize: 13 }}>
                        无人值守全自动安装
                      </Typography.Text>
                      <Tag color="blue" style={{ marginInlineEnd: 0, borderRadius: 999, fontSize: 10.5, paddingInline: 6 }}>推荐小主机</Tag>
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
                      开机自动抹除首块可用硬盘并快速完成安装，首次启动自动注册并加载全部注入驱动，插上 U 盘即可全自动装机。
                    </Typography.Text>
                  </div>
                </div>

                <div
                  className={`apple-source-card ${installMode === 'interactive' ? 'selected' : ''}`}
                  onClick={() => setInstallMode('interactive')}
                  style={{ alignItems: 'flex-start', padding: '10px 14px' }}
                >
                  <div style={{ marginTop: 2, flexShrink: 0 }}>
                    {installMode === 'interactive' ? (
                      <CheckCircleFilled style={{ color: '#0071e3', fontSize: 16 }} />
                    ) : (
                      <div style={{ width: 15, height: 15, borderRadius: '50%', border: '1.5px solid #cbd5e1' }} />
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <DesktopOutlined style={{ color: installMode === 'interactive' ? '#0071e3' : '#475569', fontSize: 14 }} />
                      <Typography.Text strong style={{ fontSize: 13 }}>
                        交互式手动安装
                      </Typography.Text>
                      <Tag style={{ marginInlineEnd: 0, borderRadius: 999, fontSize: 10.5, paddingInline: 6 }}>多盘服务器</Tag>
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
                      保留原生官方图形化安装向导，可在装机界面手动挑选目标系统盘、配置静态 IP，驱动照常预载生效。
                    </Typography.Text>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <Typography.Text type="secondary" className="field-block-label" style={{ marginBottom: 8, display: 'block' }}>
                硬件兼容与内核魔改参数（自动写入引导配置并持久化）
              </Typography.Text>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
                {[
                  {
                    key: 'hybrid_cpu',
                    title: 'Intel 大小核防紫屏 (12/13/14代/Ultra)',
                    desc: '注入 cpuUniformityHardCheckPanic=FALSE，彻底解决异构大小核混合架构调度 PSOD 紫屏。',
                    tag: '强烈推荐',
                    color: 'blue',
                  },
                  {
                    key: 'osdata_8g',
                    title: '精简系统盘占用至 8GB',
                    desc: '限制 autoPartitionOSDataSize=8192，防止 ESX-OSData 分区吞掉 120GB+ 宝贵固态空间。',
                    tag: 'SSD 必备',
                    color: 'green',
                  },
                  {
                    key: 'legacy_cpu',
                    title: '放行不受支持的老旧 CPU',
                    desc: '注入 allowLegacyCPU=true，让 E5 v3/v4 或老旧酷睿跳过 CPU 弃用警告继续装机。',
                    tag: '老机必备',
                    color: 'orange',
                  },
                  {
                    key: 'headless',
                    title: '无头模式引导 (Headless)',
                    desc: '注入 ignoreHeadless=TRUE，针对无独显/核显或不接显示器的软路由防启动卡死。',
                    tag: '软路由',
                    color: 'purple',
                  },
                ].map((item) => {
                  const active = bootOptions.includes(item.key)
                  return (
                    <div
                      key={item.key}
                      onClick={() => {
                        if (active) setBootOptions(bootOptions.filter((k) => k !== item.key))
                        else setBootOptions([...bootOptions, item.key])
                      }}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 10,
                        border: active ? '1.5px solid #0071e3' : '1px solid #e2e8f0',
                        background: active ? '#f0f7ff' : '#ffffff',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        gap: 10,
                        alignItems: 'flex-start',
                      }}
                    >
                      <Checkbox checked={active} style={{ marginTop: 2, pointerEvents: 'none' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: active ? '#0071e3' : '#0f172a' }}>
                            {item.title}
                          </span>
                          <Tag color={item.color} style={{ marginInlineEnd: 0, padding: '0 5px', fontSize: 10, borderRadius: 999 }}>
                            {item.tag}
                          </Tag>
                        </div>
                        <span style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.4 }}>
                          {item.desc}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <Form form={form} layout="vertical" initialValues={{ root_password: 'niuniu', custom_iso_name: '' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                <Form.Item name="root_password" label="Root 密码" extra="留空使用默认 niuniu" style={{ marginBottom: 0 }}>
                  <Input.Password placeholder="niuniu" style={{ maxWidth: 320, borderRadius: 8 }} />
                </Form.Item>
                <Form.Item name="custom_iso_name" label="输出文件名" extra="留空自动按公式命名" style={{ marginBottom: 0 }}>
                  <Input className="mono" placeholder={formulaPlaceholder} allowClear style={{ maxWidth: 420, borderRadius: 8 }} />
                </Form.Item>
              </div>
            </Form>

            <Divider style={{ margin: '8px 0' }} />

            <div
              className={`apple-source-card ${archiveToS3 && defaultS3Bucket ? 'selected' : ''}`}
              onClick={() => {
                if (defaultS3Bucket) setArchiveToS3((v) => !v)
              }}
              style={{ padding: '12px 14px', cursor: defaultS3Bucket ? 'pointer' : 'default' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                <CloudUploadOutlined style={{ fontSize: 18, color: archiveToS3 && defaultS3Bucket ? '#0071e3' : '#64748b' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      生成后自动转存至 S3 并清理本地生成的镜像
                    </Typography.Text>
                    {defaultS3Bucket ? (
                      <Tag color="blue" style={{ marginInlineEnd: 0, borderRadius: 999, fontSize: 10.5, paddingInline: 6 }}>
                        目标 S3：{defaultS3Bucket.name}
                      </Tag>
                    ) : (
                      <Tag style={{ marginInlineEnd: 0, borderRadius: 999, fontSize: 10.5, paddingInline: 6 }}>
                        未挂载 S3
                      </Tag>
                    )}
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                    {defaultS3Bucket
                      ? 'ISO 封装完成后自动上传至 S3 对象存储，校验 SHA-256 后立即清理本地生成的镜像文件，释放宿主机磁盘空间。'
                      : '当前仅挂载本地存储；在「存储与挂载」挂载 S3 对象存储后可开启自动转存并清理本地镜像。'}
                  </Typography.Text>
                </div>
              </div>
              <Switch
                size="small"
                checked={archiveToS3 && Boolean(defaultS3Bucket)}
                disabled={!defaultS3Bucket}
                onChange={(checked) => setArchiveToS3(checked)}
                onClick={(_, e) => e.stopPropagation()}
              />
            </div>
          </Space>
        )}

        {buildMode === 'custom' && step === 4 && (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={1} className="confirm-desc">
              <Descriptions.Item label="ESXi 版本">ESXi {version}</Descriptions.Item>
              <Descriptions.Item label="基础镜像">
                {selectedDepot ? (
                  <Space direction="vertical" size={2}>
                    <Space size={6} wrap>
                      <Tag color={fileCategoryMeta(selectedDepot.file).color} style={{ marginInlineEnd: 0, borderRadius: 999 }}>
                        {resolveDepotMeta(selectedDepot.file).badgeLabel}
                      </Tag>
                      <Typography.Text strong>{resolveDepotMeta(selectedDepot.file).zhName}</Typography.Text>
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
                      {fileName(selectedDepot.file)}
                    </Typography.Text>
                  </Space>
                ) : '未选择'}
              </Descriptions.Item>
              <Descriptions.Item label="实际引擎">
                <Tag color={engineOf(depotPath).color === 'iso' ? 'cyan' : 'gold'}>
                  {engineOf(depotPath).short}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="注入驱动">
                {selectedDrivers.length === 0 ? (
                  <Typography.Text type="secondary">不注入额外驱动（使用安装源内置驱动）</Typography.Text>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedDrivers.map((d) => {
                      const meta = resolveDriverMeta(d)
                      return (
                        <div key={d.path} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Tag color={meta.categoryColor} style={{ marginInlineEnd: 0 }}>
                            {meta.categoryLabel}
                          </Tag>
                          <Typography.Text strong>{meta.zhName}</Typography.Text>
                          {meta.hardwareChip && (
                            <Tag color="cyan" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                              {meta.hardwareChip}
                            </Tag>
                          )}
                          {meta.cleanVersion && (
                            <Typography.Text code style={{ fontSize: 11 }}>
                              v{meta.cleanVersion}
                            </Typography.Text>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="硬件魔改参数">
                {bootOptions.length === 0 ? '未启用' : (
                  <Space size={4} wrap>
                    {bootOptions.includes('hybrid_cpu') && <Tag color="blue">大小核防紫屏</Tag>}
                    {bootOptions.includes('osdata_8g') && <Tag color="green">8GB精简系统盘</Tag>}
                    {bootOptions.includes('legacy_cpu') && <Tag color="orange">老旧CPU放行</Tag>}
                    {bootOptions.includes('headless') && <Tag>无头模式</Tag>}
                  </Space>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="安装模式">
                {installMode === 'unattended' ? '无人值守' : '交互式'}
              </Descriptions.Item>
              <Descriptions.Item label="Root 密码">
                <span className="mono">{rootPwd || 'niuniu'}</span>
              </Descriptions.Item>
              <Descriptions.Item label="输出文件名">
                <span className="mono">{customName?.trim() || formulaPlaceholder + '（自动）'}</span>
              </Descriptions.Item>
              <Descriptions.Item label="产物归档与清理">
                {archiveToS3 && defaultS3Bucket ? (
                  <Tag color="success">
                    自动转存至 S3（{defaultS3Bucket.name}）并清理本地生成的镜像
                  </Tag>
                ) : (
                  <Tag>保存在当前存储盘（{selectedBucket?.name || '本地存储'}）</Tag>
                )}
              </Descriptions.Item>
            </Descriptions>

            <Alert
              type="warning"
              showIcon
              message="构建会覆盖同名输出文件"
              description="输出路径已存在时任务会直接失败，不会复用旧产物。"
            />
          </Space>
        )}

        {/* 苹果风格底部悬浮常驻操作栏（仅定制构建） */}
        {buildMode === 'custom' && (
        <div className="apple-sticky-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>底包:</span>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: '#0f172a',
                  maxWidth: 260,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {selectedDepot ? resolveDepotMeta(selectedDepot.file).zhName : '请先选择安装源'}
              </span>
            </div>

            <span style={{ color: '#cbd5e1' }}>·</span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>驱动:</span>
              <span
                aria-label={`已选 ${selectedDrivers.length} 个`}
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: selectedDrivers.length > 0 ? '#0071e3' : '#64748b',
                }}
              >
                {selectedDrivers.length > 0 ? `${selectedDrivers.length} 个已选` : '0 (原生内置)'}
              </span>
              {selectedDrivers.slice(0, 2).map((d) => {
                const m = resolveDriverMeta(d)
                return (
                  <span
                    key={d.path}
                    className="apple-module-code"
                  >
                    {m.moduleCode || m.zhName}
                  </span>
                )
              })}
              {selectedDrivers.length > 2 && (
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
                  +{selectedDrivers.length - 2}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {step > 1 && (
              <Button
                size="small"
                style={{ borderRadius: 9999, minHeight: 32, paddingInline: 14, fontWeight: 500 }}
                onClick={() => setStep((x) => Math.max(1, x - 1))}
              >
                上一步
              </Button>
            )}
            {step < 4 ? (
              <button
                type="button"
                className="apple-pill-btn"
                disabled={step === 1 && !canLeaveStep1}
                onClick={() => setStep((x) => Math.min(4, x + 1))}
              >
                <span>
                  {step === 1 ? '下一步：选择驱动 →' : step === 2 ? '下一步：配置参数 →' : '下一步：确认构建 →'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                className="apple-pill-btn"
                style={{ background: '#16a34a', boxShadow: '0 2px 8px rgba(22, 163, 74, 0.26)' }}
                disabled={createMutation.isPending}
                onClick={runPipeline}
              >
                <PlayCircleOutlined />
                <span>{createMutation.isPending ? '正在创建...' : '开始构建'}</span>
              </button>
            )}
          </div>
        </div>
        )}
      </Card>

      <Card
        id="pipeline-output"
        size="small"
        className="log-card"
        title={
          <Space size={8} wrap>
            <span className="log-card-title">构建日志</span>
            {activeTask && (
              <Typography.Text type="secondary" copyable className="log-task-id">
                {activeTask.task_id}
              </Typography.Text>
            )}
            {viewingHistory && <Tag>历史</Tag>}
          </Space>
        }
        extra={
          <Space size={8} wrap>
            {activeTask && <BuildStatusTag status={activeTask.status} />}
            {isActiveTaskArchiving && (
              <Tag color="processing" style={{ marginInlineEnd: 0, borderRadius: 999 }}>
                正在转存至 S3…
              </Tag>
            )}
            {activeTask?.status === 'completed' && activeTask.output_iso && (
              <>
                {activeTaskBucket && activeTaskBucket.type !== 'local' ? (
                  <>
                    <Tag color="success" style={{ marginInlineEnd: 0, borderRadius: 999 }}>
                      已存 S3（{activeTaskBucket.name}）· 本地已清理
                    </Tag>
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => downloadTaskArtifact(activeTask)}
                    >
                      下载 ISO
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      icon={<CopyOutlined />}
                      onClick={() => copyArtifactLink(activeTask)}
                    >
                      复制签名链接
                    </Button>
                  </>
                ) : defaultS3Bucket ? (
                  <Button
                    size="small"
                    type="primary"
                    icon={<CloudUploadOutlined />}
                    loading={archiveMutation.isPending && archiveMutation.variables === activeTask.task_id}
                    onClick={() => archiveMutation.mutate(activeTask.task_id)}
                  >
                    转存 S3 并清理本地
                  </Button>
                ) : (
                  <Button
                    size="small"
                    type="primary"
                    icon={<CopyOutlined />}
                    onClick={() => copyArtifactLink(activeTask)}
                  >
                    复制签名链接
                  </Button>
                )}
              </>
            )}
            <Radio.Group
              size="small"
              optionType="button"
              buttonStyle="solid"
              value={logViewMode}
              onChange={(e) => setLogViewMode(e.target.value as LogViewMode)}
              options={[
                { value: 'chinese', label: '中文' },
                { value: 'raw', label: '原始' },
              ]}
            />
            <Button size="small" onClick={() => setLogFilter(logFilter === 'all' ? 'issues' : 'all')}>
              {logFilter === 'all' ? '仅看错误' : '全部日志'}
            </Button>
            <Button size="small" onClick={copyLogs}>
              复制
            </Button>
          </Space>
        }
        styles={{ body: { padding: 0, maxHeight: 420, overflow: 'auto' } }}
      >
        {isActiveTaskArchiving && (
          <Alert
            type="info"
            showIcon
            message={`正在将产出镜像转存至 S3 对象存储${defaultS3Bucket ? `（${defaultS3Bucket.name}）` : ''}，大文件上传与校验期间请稍候…`}
            style={{ margin: '10px 12px 0', borderRadius: 8 }}
          />
        )}
        {activeTask?.status === 'completed' && activeTask.output_iso && (
          <div
            style={{
              margin: '10px 12px 0',
              padding: '10px 14px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
              <CheckCircleFilled style={{ color: '#16a34a', fontSize: 16, flexShrink: 0 }} />
              <Typography.Text strong style={{ fontSize: 12.5, color: '#15803d', flexShrink: 0 }}>
                产出镜像 S3 地址：
              </Typography.Text>
              <Typography.Text
                code
                ellipsis={{ tooltip: activeTaskS3Url || activeTask.output_iso }}
                style={{ fontSize: 12.5, minWidth: 0 }}
              >
                {activeTaskS3Url || activeTask.output_iso}
              </Typography.Text>
            </div>
            <Space size={8} wrap>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => downloadTaskArtifact(activeTask)}
              >
                下载 ISO
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<CopyOutlined />}
                onClick={() => copyArtifactLink(activeTask)}
              >
                复制签名链接
              </Button>
            </Space>
          </div>
        )}
        {!activeTask ? (
          <div style={{ padding: 24 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                buildMode === 'oem'
                  ? '还没有转换任务，点击品牌离线包的「一键转 ISO」后在此查看日志'
                  : '还没有构建任务，走完四步后点击「开始构建」'
              }
            />
          </div>
        ) : logViewMode === 'chinese' ? (
          filteredChineseLogs.length === 0 ? (
            <div style={{ padding: 24 }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={rawLogs.length > 0 ? '没有错误或警告' : '等待输出…'}
              />
            </div>
          ) : (
            <List
              size="small"
              dataSource={filteredChineseLogs}
              renderItem={(item, index) => (
                <List.Item
                  key={index}
                  className={
                    item.kind === 'error'
                      ? 'log-row log-row-error'
                      : item.kind === 'warn'
                        ? 'log-row log-row-warn'
                        : 'log-row'
                  }
                >
                  <span className="log-lineno">{String(index + 1).padStart(2, '0')}</span>
                  <Tag
                    className="log-badge"
                    color={
                      item.kind === 'error'
                        ? 'error'
                        : item.kind === 'warn'
                          ? 'warning'
                          : item.kind === 'success'
                            ? 'success'
                            : item.kind === 'timing'
                              ? 'blue'
                              : undefined
                    }
                  >
                    {item.badge}
                  </Tag>
                  <Typography.Text
                    type={item.kind === 'error' ? 'danger' : item.kind === 'warn' ? 'warning' : undefined}
                    className="log-msg"
                  >
                    {item.chinese}
                  </Typography.Text>
                </List.Item>
              )}
            />
          )
        ) : (
          <List
            size="small"
            dataSource={filteredRawLogs}
            renderItem={(line, index) => (
              <List.Item key={index} className="log-row">
                <span className="log-lineno">{String(index + 1).padStart(2, '0')}</span>
                <Typography.Text className="log-msg log-msg-raw">{line}</Typography.Text>
              </List.Item>
            )}
          />
        )}
      </Card>

      <Drawer
        title="历史流水线"
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        width={820}
        destroyOnClose
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => recentBuildsQuery.refetch()}>
            刷新
          </Button>
        }
      >
        <Table
          size="small"
          rowKey="task_id"
          dataSource={recentBuilds}
          loading={recentBuildsQuery.isLoading}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 640 }}
          rowClassName={(r) => (r.task_id === activeTaskId ? 'ant-table-row-selected' : '')}
          onRow={(r) => ({
            style: { cursor: 'pointer' },
            onClick: () => {
              setActiveTaskId(r.task_id)
              setHistoryDrawerOpen(false)
              window.setTimeout(
                () => document.getElementById('pipeline-output')?.scrollIntoView?.({ behavior: 'smooth' }),
                100
              )
            },
          })}
          columns={[
            {
              title: '任务 / 产物',
              key: 'task',
              render: (_, r: BuildTask) => {
                const s3Url = resolveTaskS3Url(r) || r.output_iso
                return (
                  <div className="table-cell-stack">
                    <Typography.Text strong ellipsis style={{ maxWidth: 260 }}>
                      {r.custom_iso_name || `ESXi-${r.esxi_version || '8.0'}-custom.iso`}
                    </Typography.Text>
                    {r.status === 'completed' && s3Url ? (
                      <Typography.Text
                        type="secondary"
                        className="mono"
                        ellipsis={{ tooltip: s3Url }}
                        style={{ fontSize: 11, maxWidth: 320 }}
                      >
                        {s3Url}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary" className="mono" style={{ fontSize: 11 }}>
                        {r.task_id}
                      </Typography.Text>
                    )}
                  </div>
                )
              },
            },
            { title: '版本', dataIndex: 'esxi_version', width: 80 },
            {
              title: '状态',
              key: 'status',
              width: 100,
              render: (_, r: BuildTask) => <BuildStatusTag status={r.status} />,
            },
            {
              title: '耗时',
              dataIndex: 'build_duration',
              width: 70,
              render: (d: number | undefined) => (d ? `${d}s` : '-'),
            },
            { title: '创建时间', dataIndex: 'created_at', width: 150, render: (t: string) => formatDate(t) },
            {
              title: '操作',
              key: 'actions',
              width: 120,
              render: (_, r: BuildTask) => (
                <Space size={4} onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="查看日志">
                    <Button
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => {
                        setActiveTaskId(r.task_id)
                        setHistoryDrawerOpen(false)
                      }}
                    />
                  </Tooltip>
                  {r.status === 'completed' && r.output_iso && (
                    <>
                      <Tooltip title="直链下载 ISO">
                        <Button
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={() => downloadTaskArtifact(r)}
                        />
                      </Tooltip>
                      <Tooltip title="复制 S3 签名下载链接">
                        <Button
                          size="small"
                          icon={<CopyOutlined />}
                          onClick={() => copyArtifactLink(r)}
                        />
                      </Tooltip>
                    </>
                  )}
                  <Popconfirm
                    title="删除该构建记录？"
                    onConfirm={() => deleteMutation.mutate(r.task_id)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Drawer>
    </div>
  )
}
