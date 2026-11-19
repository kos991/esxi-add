import { Button, Card, Spin, Typography } from 'antd'
import { useEffect, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyOutlined, LockOutlined } from './icons'
import { useAdminAuth } from '../contexts/AdminAuthContext'

export function AdminRouteGuard({ children }: { children: ReactNode }) {
  const { status, isLoading, openAdminDialog } = useAdminAuth()
  const navigate = useNavigate()
  const promptedRef = useRef(false)

  useEffect(() => {
    if (!isLoading && (!status.configured || !status.authenticated) && !promptedRef.current) {
      promptedRef.current = true
      openAdminDialog()
    }
    if (status.configured && status.authenticated) {
      promptedRef.current = false
    }
  }, [isLoading, openAdminDialog, status.authenticated, status.configured])

  if (isLoading) {
    return (
      <div className="page-shell" style={{ display: 'grid', placeItems: 'center', minHeight: 320 }}>
        <Spin tip="正在校验管理员状态…" />
      </div>
    )
  }

  if (status.configured && status.authenticated) {
    return <>{children}</>
  }

  return (
    <div className="page-shell">
      <Card className="apple-storage-card admin-gate-card">
        <div className="admin-gate-inner">
          <div className="admin-gate-icon">
            {status.configured ? <LockOutlined /> : <KeyOutlined />}
          </div>
          <Typography.Title level={5} style={{ margin: '4px 0 2px' }}>
            {status.configured ? '「存储与挂载」需要管理员权限' : '请先设置管理员密码'}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ maxWidth: 420, textAlign: 'center' }}>
            {status.configured
              ? '管理 S3 对象存储桶、上传或删除基础离线包与驱动需要管理员身份验证。普通访客可直接返回构建流水线打包下载 ISO。'
              : '首次管理存储与镜像文件前，请先设置管理员密码（保存在本地数据库，支持随时修改）。'}
          </Typography.Text>
          <div className="admin-gate-actions">
            <Button onClick={() => navigate('/build')}>返回构建流水线</Button>
            <Button type="primary" onClick={() => openAdminDialog()}>
              {status.configured ? '登录管理员' : '立即设置密码'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
