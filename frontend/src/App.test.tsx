import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './layouts/AppShell'

describe('2-Page Clean AppShell layout', () => {
  it('renders strictly the 2 core navigation items (构建流水线, 存储与挂载)', async () => {
    render(
      <AppShell pathname="/build" navigate={vi.fn()}>
        <div>流水线内容区</div>
      </AppShell>
    )

    expect(await screen.findByLabelText('ESXi ISO Builder')).toBeInTheDocument()
    expect(await screen.findByText('构建流水线')).toBeInTheDocument()
    expect(screen.getByText('存储与挂载')).toBeInTheDocument()
    expect(screen.queryByText('总览')).not.toBeInTheDocument()
    expect(screen.queryByText('任务日志')).not.toBeInTheDocument()
    expect(screen.getByText('流水线内容区')).toBeInTheDocument()
  })

  it('toggles collapse cleanly', () => {
    render(
      <AppShell pathname="/build" navigate={vi.fn()}>
        <div>流水线内容区</div>
      </AppShell>
    )

    const mainLayout = screen.getByTestId('app-main-layout')
    expect(mainLayout).toHaveStyle({
      marginLeft: '216px',
      width: 'calc(100% - 216px)',
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

