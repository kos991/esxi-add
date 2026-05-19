import { CopyOutlined, DeleteOutlined, EditOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { PageContainer, ProCard, StatisticCard } from '../components/pro-compat'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, Upload, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { UploadFile } from 'antd/es/upload/interface'
import { useMemo, useState } from 'react'
import { listBuckets } from '../api/buckets'
import { deleteFile, listDepots, listDrivers, listISOs, refreshFiles, renameFile, uploadFile } from '../api/files'
import type { FileMetadata } from '../types'
import { buildPublicObjectUrl, formatDate } from '../utils'
import { assetTitle, assetTypeText, bucketLocation, bucketType, cacheStatusColor, cacheStatusText, compactSize, esxiVersions } from './pageUtils'

type UploadType = 'depot' | 'driver' | 'iso'

const categories = [
  { value: 'network', label: 'Network' },
  { value: 'storage', label: 'Storage' },
  { value: 'raid', label: 'RAID' },
  { value: 'other', label: 'Other' },
]

export default function FilesPage() {
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [messageApi, contextHolder] = message.useMessage()
  const [bucketId, setBucketId] = useState<number | undefined>()
  const [version, setVersion] = useState('8.0')
  const [category, setCategory] = useState('network')
  const [uploadType, setUploadType] = useState<UploadType>('depot')
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [renaming, setRenaming] = useState<FileMetadata | null>(null)

  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })
  const selectedBucketId = useMemo(
    () => bucketId ?? bucketsQuery.data?.find((bucket) => bucket.is_default)?.id ?? bucketsQuery.data?.[0]?.id,
    [bucketId, bucketsQuery.data]
  )
  const selectedBucket = useMemo(
    () => bucketsQuery.data?.find((bucket) => bucket.id === selectedBucketId),
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

  const refreshMutation = useMutation({
    mutationFn: () => refreshFiles(selectedBucketId as number),
    onSuccess: async () => {
      messageApi.success('元数据已刷新')
      await invalidateFiles()
    },
    onError: (error) => messageApi.error(String(error)),
  })

  const uploadMutation = useMutation({
    mutationFn: () => {
      const file = fileList[0]?.originFileObj
      if (!selectedBucketId || !file) throw new Error('请选择存储节点和文件')
      return uploadFile(selectedBucketId, uploadType, file, uploadType === 'iso' ? undefined : version, uploadType === 'driver' ? category : undefined)
    },
    onSuccess: async () => {
      messageApi.success('文件已上传')
      setFileList([])
      await invalidateFiles()
    },
    onError: (error) => messageApi.error(String(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteFile,
    onSuccess: async () => {
      messageApi.success('文件已删除')
      await invalidateFiles()
    },
    onError: (error) => messageApi.error(String(error)),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => renameFile(id, name),
    onSuccess: async () => {
      messageApi.success('文件已重命名')
      setRenaming(null)
      form.resetFields()
      await invalidateFiles()
    },
    onError: (error) => messageApi.error(String(error)),
  })

  const copyLink = async (file: FileMetadata) => {
    const link = selectedBucket?.public_domain ? buildPublicObjectUrl(selectedBucket.public_domain, file.path) ?? file.path : file.path
    await navigator.clipboard.writeText(link)
    messageApi.success('链接已复制')
  }

  const allAssets = useMemo(
    () => [...(depotsQuery.data ?? []), ...(allDriversQuery.data ?? []), ...(isoQuery.data ?? [])].sort((a, b) => a.path.localeCompare(b.path)),
    [allDriversQuery.data, depotsQuery.data, isoQuery.data]
  )

  const columns: ColumnsType<FileMetadata> = [
    {
      title: '资产',
      render: (_, file) => (
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{assetTitle(file)}</Typography.Text>
          <Typography.Text type="secondary" className="mono" style={{ fontSize: 12 }}>
            MD5: {file.md5 || '-'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '类型',
      width: 120,
      render: (_, file) => <Tag color={file.type === 'depot' ? 'blue' : file.type === 'driver' ? 'green' : 'purple'}>{assetTypeText(file)}</Tag>,
    },
    {
      title: '路径',
      render: (_, file) => (
        <Typography.Text className="mono table-path" copyable>
          {file.path}
        </Typography.Text>
      ),
    },
    { title: '大小', width: 120, render: (_, file) => compactSize(file.size) },
    { title: '缓存', width: 120, render: (_, file) => <Tag color={cacheStatusColor(file, selectedBucket)}>{cacheStatusText(file, selectedBucket)}</Tag> },
    { title: '更新时间', width: 180, render: (_, file) => formatDate(file.last_modified) },
    {
      title: '操作',
      width: 180,
      align: 'right',
      render: (_, file) => (
        <Space>
          <Button size="small" icon={<CopyOutlined />} onClick={() => copyLink(file)} />
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setRenaming(file)
              form.setFieldsValue({ name: assetTitle(file) })
            }}
          />
          <Popconfirm title={`删除 ${assetTitle(file)}？`} okText="删除" cancelText="取消" onConfirm={() => deleteMutation.mutate(file.id)}>
            <Button danger size="small" icon={<DeleteOutlined />} loading={deleteMutation.isPending} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const renderTable = (data: FileMetadata[], loading: boolean, emptyText: string) => (
    <Table
      rowKey="id"
      size="middle"
      columns={columns}
      dataSource={data}
      loading={loading}
      locale={{ emptyText }}
      scroll={{ x: 1040 }}
      pagination={{ pageSize: 8, showSizeChanger: false }}
    />
  )

  return (
    <PageContainer title="文件库" subTitle="管理 Depot、驱动包与 ISO 产物">
      {contextHolder}
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <ProCard
          bordered
          headerBordered
          title="当前存储"
          extra={
            <Space wrap className="card-toolbar">
              <Select
                style={{ width: 260 }}
                placeholder="选择存储节点"
                value={selectedBucketId}
                onChange={setBucketId}
                options={(bucketsQuery.data ?? []).map((bucket) => ({ value: bucket.id, label: `${bucket.name}${bucket.is_default ? '（默认）' : ''}` }))}
              />
              <Button icon={<ReloadOutlined />} onClick={() => refreshMutation.mutate()} loading={refreshMutation.isPending} disabled={!selectedBucketId}>
                刷新元数据
              </Button>
            </Space>
          }
        >
          <Space orientation="vertical" size={4}>
            <Space>
              <Typography.Text strong>{selectedBucket?.name ?? '未选择'}</Typography.Text>
              <Tag color={bucketType(selectedBucket) === 'local' ? 'purple' : 'blue'}>{bucketType(selectedBucket).toUpperCase()}</Tag>
              {selectedBucket?.is_default && <Tag color="success">默认</Tag>}
            </Space>
            <Typography.Text className="mono table-path" type="secondary" copyable>
              {bucketLocation(selectedBucket)}
            </Typography.Text>
          </Space>
        </ProCard>

        <StatisticCard.Group>
          <StatisticCard statistic={{ title: '全部资产', value: allAssets.length }} />
          <StatisticCard statistic={{ title: 'Depot', value: depotsQuery.data?.length ?? 0 }} />
          <StatisticCard statistic={{ title: '驱动', value: allDriversQuery.data?.length ?? 0 }} />
          <StatisticCard statistic={{ title: 'ISO', value: isoQuery.data?.length ?? 0 }} />
        </StatisticCard.Group>

        <ProCard title="上传文件" bordered headerBordered>
          <Space wrap align="end" className="upload-toolbar">
            <Select<UploadType>
              style={{ width: 160 }}
              value={uploadType}
              onChange={setUploadType}
              options={[
                { value: 'depot', label: 'Depot' },
                { value: 'driver', label: '驱动' },
                { value: 'iso', label: 'ISO' },
              ]}
            />
            {uploadType !== 'iso' && <Select style={{ width: 140 }} value={version} onChange={setVersion} options={esxiVersions.map((item) => ({ value: item, label: `ESXi ${item}` }))} />}
            {uploadType === 'driver' && <Select style={{ width: 140 }} value={category} onChange={setCategory} options={categories} />}
            <Upload beforeUpload={() => false} maxCount={1} fileList={fileList} onChange={({ fileList: next }) => setFileList(next)}>
              <Button icon={<UploadOutlined />}>选择文件</Button>
            </Upload>
            <Button type="primary" onClick={() => uploadMutation.mutate()} loading={uploadMutation.isPending} disabled={!selectedBucketId || fileList.length === 0}>
              上传
            </Button>
          </Space>
        </ProCard>

        <ProCard bordered headerBordered styles={{ body: { padding: 0 } }} className="asset-table-card">
          <Tabs
            items={[
              { key: 'all', label: `全部资产 (${allAssets.length})`, children: renderTable(allAssets, depotsQuery.isLoading || allDriversQuery.isLoading || isoQuery.isLoading, '暂无资产') },
              { key: 'depots', label: `Depot (${depotsQuery.data?.length ?? 0})`, children: renderTable(depotsQuery.data ?? [], depotsQuery.isLoading, '暂无 Depot 文件') },
              { key: 'drivers', label: `驱动 (${driversQuery.data?.length ?? 0})`, children: renderTable(driversQuery.data ?? [], driversQuery.isLoading, '暂无匹配驱动') },
              { key: 'isos', label: `ISO (${isoQuery.data?.length ?? 0})`, children: renderTable(isoQuery.data ?? [], isoQuery.isLoading, '暂无 ISO 文件') },
            ]}
          />
        </ProCard>
      </Space>

      <Modal
        title="重命名文件"
        open={Boolean(renaming)}
        onCancel={() => setRenaming(null)}
        onOk={() => form.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={renameMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(values) => renaming && renameMutation.mutate({ id: renaming.id, name: values.name })}>
          <Form.Item name="name" label="文件显示名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  )
}
