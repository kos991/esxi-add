import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './layouts/AppShell'

describe('顶栏两页切换（无侧栏）', () => {
  it('只提供「构建 / 存储」两个入口，且不渲染侧栏', async () => {
    const navigate = vi.fn()
    render(
      <AppShell pathname="/build" navigate={navigate}>
        <div>内容区</div>
      </AppShell>
    )

    expect(await screen.findByText('ESXi Builder')).toBeInTheDocument()
    expect(screen.getByText('构建')).toBeInTheDocument()
    expect(screen.getByText('存储')).toBeInTheDocument()
    expect(screen.getByText('内容区')).toBeInTheDocument()

    // 没有侧栏、没有汉堡按钮
    expect(document.querySelector('.ant-layout-sider')).toBeNull()
    expect(screen.queryByLabelText('打开导航')).not.toBeInTheDocument()
  })

  it('在构建页点「存储」会跳转，在存储页点「构建」会跳转', async () => {
    const nav1 = vi.fn()
    const { unmount } = render(
      <AppShell pathname="/build" navigate={nav1}>
        <div>内容区</div>
      </AppShell>
    )
    await screen.findByText('存储')
    fireEvent.click(screen.getAllByRole('radio')[1])
    expect(nav1).toHaveBeenCalledWith('/storage')
    unmount()

    const nav2 = vi.fn()
    render(
      <AppShell pathname="/storage" navigate={nav2}>
        <div>内容区</div>
      </AppShell>
    )
    await screen.findByText('构建')
    fireEvent.click(screen.getAllByRole('radio')[0])
    expect(nav2).toHaveBeenCalledWith('/build')
  })
})
