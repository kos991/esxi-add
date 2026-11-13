import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProCard } from './components/pro-compat'
import { AppShell } from './layouts/AppShell'

describe('Unified 3-Page AppShell layout', () => {
  it('renders strictly the 3 core navigation items (总览, 存储与文件库, 构建工作台)', async () => {
    render(
      <AppShell pathname="/build" navigate={vi.fn()}>
        <div>自定义构建页面</div>
      </AppShell>
    )

    expect(await screen.findByLabelText('ESXi ISO Builder')).toBeInTheDocument()
    expect(await screen.findByText('总览')).toBeInTheDocument()
    expect(screen.getByText('存储与文件库')).toBeInTheDocument()
    expect(screen.getByText('构建工作台')).toBeInTheDocument()
    expect(screen.queryByText('任务日志')).not.toBeInTheDocument()
    expect(screen.queryByText('存储节点')).not.toBeInTheDocument()
    expect(screen.getByText('自定义构建页面')).toBeInTheDocument()
  })

  it('sizes the main content layout using 100% rather than 100vw and toggles collapse cleanly', () => {
    render(
      <AppShell pathname="/" navigate={vi.fn()}>
        <div>总览页面</div>
      </AppShell>
    )

    const mainLayout = screen.getByTestId('app-main-layout')
    expect(mainLayout).toHaveStyle({
      marginLeft: '216px',
      width: 'calc(100% - 216px)',
      minWidth: '0',
    })

    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }))
    expect(mainLayout).toHaveStyle({
      marginLeft: '72px',
      width: 'calc(100% - 72px)',
    })

    fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }))
    expect(mainLayout).toHaveStyle({
      marginLeft: '216px',
      width: 'calc(100% - 216px)',
    })
  })
})

describe('Ant Design compatibility wrappers', () => {
  it('maps ProCard variant and semantic body styles to Ant Design Card', () => {
    render(
      <ProCard variant="borderless" styles={{ body: { backgroundColor: 'rgb(1, 2, 3)' } }}>
        V6 card body
      </ProCard>
    )

    expect(screen.getByText('V6 card body').closest('.ant-pro-card-body')).toHaveStyle({
      backgroundColor: 'rgb(1, 2, 3)',
    })
  })
})
