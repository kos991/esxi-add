import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdminAuthDialog } from './components/AdminAuthDialog'
import { AppShell } from './layouts/AppShell'

describe('顶栏两页切换与版本号/管理员入口', () => {
  it('显示构建流水线、存储与挂载、版本号且不渲染侧栏', async () => {
    const navigate = vi.fn()
    const onAdminClick = vi.fn()
    render(
      <AppShell
        pathname="/build"
        navigate={navigate}
        version="v1.0.1"
        auth={{
          version: 'v1.0.1',
          configured: false,
          authenticated: false,
          env_managed: false,
        }}
        onAdminClick={onAdminClick}
      >
        <div>内容区</div>
      </AppShell>
    )

    expect(await screen.findByText('ESXi Builder')).toBeInTheDocument()
    expect(screen.getByText('构建流水线')).toBeInTheDocument()
    expect(screen.getByText('存储与挂载')).toBeInTheDocument()
    expect(screen.getByText('v1.0.1')).toBeInTheDocument()
    expect(screen.getByText('设置管理员')).toBeInTheDocument()
    expect(screen.getByText('内容区')).toBeInTheDocument()

    fireEvent.click(screen.getByText('设置管理员'))
    expect(onAdminClick).toHaveBeenCalledTimes(1)

    expect(document.querySelector('.ant-layout-sider')).toBeNull()
    expect(screen.queryByLabelText('打开导航')).not.toBeInTheDocument()
  })

  it('点击顶栏导航项可以切换页面', async () => {
    const nav1 = vi.fn()
    const { unmount } = render(
      <AppShell pathname="/build" navigate={nav1}>
        <div>内容区</div>
      </AppShell>
    )
    fireEvent.click(await screen.findByText('存储与挂载'))
    expect(nav1).toHaveBeenCalledWith('/storage')
    unmount()

    const nav2 = vi.fn()
    render(
      <AppShell pathname="/storage" navigate={nav2}>
        <div>内容区</div>
      </AppShell>
    )
    fireEvent.click(await screen.findByText('构建流水线'))
    expect(nav2).toHaveBeenCalledWith('/build')
  })

  it('原生管理员弹窗按状态切换初始化密码与登录语义', () => {
    const onClose = vi.fn()
    const onStatusChange = vi.fn()

    const { rerender } = render(
      <AdminAuthDialog
        open={true}
        status={{ version: 'v1.0.1', configured: false, authenticated: false, env_managed: false }}
        onClose={onClose}
        onStatusChange={onStatusChange}
      />
    )

    const dialog = document.querySelector('dialog.admin-native-dialog')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('role')).toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBeNull()

    const setupInput = screen.getByLabelText('新管理员密码') as HTMLInputElement
    expect(setupInput.getAttribute('autocomplete')).toBe('new-password')

    rerender(
      <AdminAuthDialog
        open={true}
        status={{ version: 'v1.0.1', configured: true, authenticated: false, env_managed: false }}
        onClose={onClose}
        onStatusChange={onStatusChange}
      />
    )

    const loginInput = screen.getByLabelText('管理员密码') as HTMLInputElement
    expect(loginInput.getAttribute('autocomplete')).toBe('current-password')
  })
})
