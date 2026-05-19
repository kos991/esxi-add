import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProCard } from './components/pro-compat'
import { AppShell } from './layouts/AppShell'

describe('Ant Design Pro layout', () => {
  it('renders icon-only brand and visible short Chinese navigation without Docker status text', async () => {
    render(
      <AppShell pathname="/build" navigate={vi.fn()}>
        <div>自定义构建页面</div>
      </AppShell>
    )

    expect(await screen.findByLabelText('ESXi ISO Builder')).toBeInTheDocument()
    expect(screen.queryByText('ISO Build')).not.toBeInTheDocument()
    expect(screen.queryByText('ESXi 自动化')).not.toBeInTheDocument()
    expect(await screen.findByText('总览')).toBeInTheDocument()
    expect(screen.getByText('存储节点')).toBeInTheDocument()
    expect(screen.getByText('文件库')).toBeInTheDocument()
    expect(screen.getByText('构建流水线')).toBeInTheDocument()
    expect(screen.getByText('任务日志')).toBeInTheDocument()
    expect(screen.getByLabelText('dashboard')).toBeInTheDocument()
    expect(screen.getByLabelText('hdd')).toBeInTheDocument()
    expect(screen.getByLabelText('folder-open')).toBeInTheDocument()
    expect(screen.getByLabelText('deployment-unit')).toBeInTheDocument()
    expect(screen.getByLabelText('file-search')).toBeInTheDocument()
    expect(screen.getByText('自定义构建页面')).toBeInTheDocument()
    expect(screen.queryByText(/Docker/i)).not.toBeInTheDocument()
  })

  it('sizes the main content layout within the remaining viewport width', () => {
    render(
      <AppShell pathname="/" navigate={vi.fn()}>
        <div>总览页面</div>
      </AppShell>
    )

    const mainLayout = screen.getByTestId('app-main-layout')
    expect(mainLayout).toHaveStyle({
      marginLeft: '72px',
      width: 'calc(100vw - 72px)',
      minWidth: '0',
    })
  })

  it('starts collapsed and expands with an accessible control', () => {
    render(
      <AppShell pathname="/" navigate={vi.fn()}>
        <div>总览页面</div>
      </AppShell>
    )

    const mainLayout = screen.getByTestId('app-main-layout')
    expect(mainLayout).toHaveStyle({
      marginLeft: '72px',
      width: 'calc(100vw - 72px)',
    })

    fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }))
    expect(mainLayout).toHaveStyle({
      marginLeft: '212px',
      width: 'calc(100vw - 212px)',
    })

    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }))
    expect(mainLayout).toHaveStyle({
      marginLeft: '72px',
      width: 'calc(100vw - 72px)',
    })
  })
})

describe('Ant Design v6 compatibility wrappers', () => {
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
