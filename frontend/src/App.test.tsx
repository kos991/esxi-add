import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './layouts/AppShell'

describe('Ant Design Pro layout', () => {
  it('renders icon-only brand and short Chinese navigation without Docker status text', async () => {
    render(
      <AppShell pathname="/build" navigate={vi.fn()}>
        <div>自定义构建页面</div>
      </AppShell>
    )

    expect(await screen.findByLabelText('ESXi ISO Builder')).toBeInTheDocument()
    expect(screen.queryByText('ISO Build')).not.toBeInTheDocument()
    expect(screen.queryByText('ESXi 自动化')).not.toBeInTheDocument()
    expect(await screen.findByText('总览')).toBeInTheDocument()
    expect(screen.getByText('存储')).toBeInTheDocument()
    expect(screen.getByText('文件库')).toBeInTheDocument()
    expect(screen.getByText('构建')).toBeInTheDocument()
    expect(screen.getByText('日志')).toBeInTheDocument()
    expect(screen.getByText('自定义构建页面')).toBeInTheDocument()
    expect(screen.queryByText(/Docker/i)).not.toBeInTheDocument()
  })
})
