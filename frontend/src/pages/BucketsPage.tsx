import { CloudOutlined, DatabaseOutlined, FolderOpenOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { PageContainer, ProCard, StatisticCard } from '../components/pro-compat'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo, useState } from 'react'
import { createBucket, deleteBucket, listBuckets, setDefaultBucket, testBucketConnection, updateBucket, type BucketPayload } from '../api/buckets'
import type { StorageBucket } from '../types'
import { bucketLocation, bucketType } from './pageUtils'

const defaultPayload: BucketPayload = {
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

export default function BucketsPage() {
  const [form] = Form.useForm<BucketPayload>()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editingBucket, setEditingBucket] = useState<StorageBucket | null>(null)
  const [storageType, setStorageType] = useState<'s3' | 'local'>('s3')
  const [messageApi, contextHolder] = message.useMessage()
  const bucketsQuery = useQuery({ queryKey: ['buckets'], queryFn: listBuckets })

  const sortedBuckets = useMemo(
    () => [...(bucketsQuery.data ?? [])].sort((a, b) => Number(b.is_default) - Number(a.is_default)),
    [bucketsQuery.data]
  )
  const defaultBucket = sortedBuckets.find((bucket) => bucket.is_default)

  const closeModal = () => {
    setOpen(false)
    setEditingBucket(null)
    setStorageType('s3')
    form.resetFields()
  }

  const invalidateBuckets = async () => {
    await queryClient.invalidateQueries({ queryKey: ['buckets'] })
  }

  const saveMutation = useMutation({
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
              local_path: '',
              use_ssl: payload.use_ssl ?? true,
            }

      return editingBucket ? updateBucket(editingBucket.id, normalized) : createBucket(normalized)
    },
    onSuccess: async () => {
      messageApi.success(editingBucket ? '存储节点已更新' : '存储节点已创建')
      closeModal()
      await invalidateBuckets()
    },
    onError: (error) => messageApi.error(String(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteBucket,
    onSuccess: async () => {
      messageApi.success('存储节点已删除')
      await invalidateBuckets()
    },
    onError: (error) => messageApi.error(String(error)),
  })

  const defaultMutation = useMutation({
    mutationFn: setDefaultBucket,
    onSuccess: async () => {
      messageApi.success('默认存储已更新')
      await invalidateBuckets()
    },
    onError: (error) => messageApi.error(String(error)),
  })

  const testMutation = useMutation({
    mutationFn: testBucketConnection,
    onSuccess: () => messageApi.success('连接测试成功'),
    onError: (error) => messageApi.error(String(error)),
  })

  const openCreate = () => {
    setEditingBucket(null)
    setStorageType('s3')
    form.setFieldsValue(defaultPayload)
    setOpen(true)
  }

  const openEdit = (bucket: StorageBucket) => {
    const type = bucketType(bucket)
    setEditingBucket(bucket)
    setStorageType(type)
    form.setFieldsValue({
      ...defaultPayload,
      ...bucket,
      type,
    })
    setOpen(true)
  }

  const columns: ColumnsType<StorageBucket> = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (value: string, bucket) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{value}</Typography.Text>
          {bucket.is_default && <Tag color="success">默认</Tag>}
        </Space>
      ),
    },
    {
      title: '类型',
      width: 110,
      render: (_, bucket) => <Tag color={bucketType(bucket) === 'local' ? 'purple' : 'blue'}>{bucketType(bucket).toUpperCase()}</Tag>,
    },
    {
      title: '地址 / 挂载点',
      render: (_, bucket) => (
        <Typography.Text className="mono table-path" copyable>
          {bucketLocation(bucket)}
        </Typography.Text>
      ),
    },
    {
      title: '区域 / Bucket',
      render: (_, bucket) => (bucketType(bucket) === 'local' ? '-' : `${bucket.region || '-'} / ${bucket.bucket_name || '-'}`),
    },
    {
      title: '操作',
      width: 250,
      align: 'right',
      render: (_, bucket) => (
        <Space wrap>
          <Button size="small" onClick={() => testMutation.mutate(bucket.id)} loading={testMutation.isPending}>
            测试
          </Button>
          <Button size="small" onClick={() => openEdit(bucket)}>
            编辑
          </Button>
          {!bucket.is_default && (
            <Button size="small" onClick={() => defaultMutation.mutate(bucket.id)} loading={defaultMutation.isPending}>
              设为默认
            </Button>
          )}
          <Popconfirm title={`删除 ${bucket.name}？`} okText="删除" cancelText="取消" onConfirm={() => deleteMutation.mutate(bucket.id)}>
            <Button danger size="small" loading={deleteMutation.isPending}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <PageContainer
      title="存储挂载"
      subTitle="管理 S3/R2 兼容对象存储与容器本地目录"
      extra={[
        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建存储
        </Button>,
      ]}
    >
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <StatisticCard.Group>
          <StatisticCard statistic={{ title: '存储节点', value: sortedBuckets.length, icon: <DatabaseOutlined /> }} />
          <StatisticCard statistic={{ title: '默认节点', value: defaultBucket?.name ?? '未设置', icon: <CloudOutlined /> }} />
          <StatisticCard statistic={{ title: '挂载方式', value: defaultBucket ? bucketType(defaultBucket).toUpperCase() : '-', icon: <FolderOpenOutlined /> }} />
        </StatisticCard.Group>

        <ProCard
          title="存储节点"
          bordered
          headerBordered
          extra={
            <Button icon={<ReloadOutlined />} onClick={() => bucketsQuery.refetch()} loading={bucketsQuery.isFetching}>
              刷新
            </Button>
          }
        >
          <Table
            rowKey="id"
            size="middle"
            columns={columns}
            dataSource={sortedBuckets}
            loading={bucketsQuery.isLoading}
            pagination={false}
            scroll={{ x: 960 }}
          />
        </ProCard>
      </Space>

      <Modal
        title={editingBucket ? '编辑存储节点' : '新建存储节点'}
        open={open}
        onCancel={closeModal}
        onOk={() => form.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={saveMutation.isPending}
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={defaultPayload} onFinish={(values) => saveMutation.mutate(values)}>
          <Form.Item name="type" label="存储类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 's3', label: 'S3 兼容对象存储 / Cloudflare R2' },
                { value: 'local', label: '容器本地目录' },
              ]}
              onChange={(value) => setStorageType(value)}
            />
          </Form.Item>
          <Form.Item name="name" label="节点名称" rules={[{ required: true, message: '请输入节点名称' }]}>
            <Input placeholder="例如：r2-esxi-build" />
          </Form.Item>
          {storageType === 'local' ? (
            <Form.Item name="local_path" label="容器内挂载路径" rules={[{ required: true, message: '请输入本地路径' }]}>
              <Input className="mono" placeholder="/data/storage" />
            </Form.Item>
          ) : (
            <>
              <Form.Item name="endpoint" label="Endpoint 地址" rules={[{ required: true, message: '请输入 Endpoint' }]}>
                <Input className="mono" placeholder="https://account.r2.cloudflarestorage.com" />
              </Form.Item>
              <Form.Item name="bucket_name" label="Bucket 名称" rules={[{ required: true, message: '请输入 Bucket 名称' }]}>
                <Input className="mono" />
              </Form.Item>
              <Form.Item name="region" label="Region">
                <Input placeholder="可选" />
              </Form.Item>
              <Form.Item name="access_key" label="Access Key" rules={[{ required: true, message: '请输入 Access Key' }]}>
                <Input className="mono" />
              </Form.Item>
              <Form.Item name="secret_key" label="Secret Key" rules={[{ required: !editingBucket, message: '请输入 Secret Key' }]}>
                <Input.Password className="mono" />
              </Form.Item>
              <Form.Item name="public_domain" label="公开访问域名">
                <Input className="mono" placeholder="用于复制 ISO 下载链接，可选" />
              </Form.Item>
              <Form.Item name="use_ssl" label="使用 SSL" valuePropName="checked">
                <Switch />
              </Form.Item>
            </>
          )}
          <Form.Item name="is_default" label="设为默认存储" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  )
}
