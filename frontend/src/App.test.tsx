import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './layouts/AppShell'

describe('顶栏两页切换（无侧栏）', () => {
  it('只提供「构建流水线 / 存储与挂载」两个入口，且不渲染侧栏', async () => {
    const navigate = vi.fn()
    render(
      <AppShell pathname="/build" navigate={navigate}>
        <div>内容区</div>
      </AppShell>
    )

    expect(await screen.findByText('ESXi Builder')).toBeInTheDocument()
    expect(screen.getByText('构建流水线')).toBeInTheDocument()
    expect(screen.getByText('存储与挂载')).toBeInTheDocument()
    expect(screen.getByText('内容区')).toBeInTheDocument()

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
})
