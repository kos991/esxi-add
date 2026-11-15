import {
  DatabaseOutlined,
  DeploymentUnitOutlined,
  GithubOutlined,
} from '../components/icons'
import { ConfigProvider, Segmented, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'

const HEADER_HEIGHT = 52

type AppShellProps = {
  pathname: string
  navigate: (path: string) => void
  children: ReactNode
}

function resolvePage(pathname: string): 'build' | 'storage' {
  if (pathname.startsWith('/storage') || pathname.startsWith('/buckets') || pathname.startsWith('/files')) {
    return 'storage'
  }
  return 'build'
}

/**
 * 只有两个页面，所以取消侧栏与抽屉导航：
 * 顶部一行 logo + 两个页面切换，把宽度全部让给内容。
 */
export function AppShell({ pathname, navigate, children }: AppShellProps) {
  const page = resolvePage(pathname)

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          colorSuccess: '#059669',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          colorBgLayout: '#f4f7fb',
          colorText: '#0f172a',
          colorTextSecondary: '#64748b',
          colorBorderSecondary: '#e6ebf2',
          borderRadius: 10,
          fontSize: 14,
          lineHeight: 1.6,
          fontFamily:
            'Inter, "Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        components: {
          Card: { headerBg: '#ffffff' },
          Segmented: { itemSelectedBg: '#ffffff' },
          Table: { headerBg: '#f8fafc', headerColor: '#475569' },
        },
        algorithm: theme.defaultAlgorithm,
      }}
    >
      <a href="#main-content" className="skip-link">
        跳到主要内容
      </a>

      <header className="topbar">
        <a className="topbar-brand" href="/build" onClick={(e) => { e.preventDefault(); navigate('/build') }}>
          <svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true">
            <defs>
              <linearGradient id="brand-grad" x1="8" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                <stop stopColor="#2563eb" />
                <stop offset="0.55" stopColor="#0ea5e9" />
                <stop offset="1" stopColor="#10b981" />
              </linearGradient>
            </defs>
            <rect x="3" y="3" width="34" height="34" rx="10" fill="url(#brand-grad)" />
            <path d="M12 14h10c2.6 0 4.6 2 4.6 4.6s-2 4.6-4.6 4.6H12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M12 19.2h13" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity="0.75" />
            <circle cx="26.5" cy="19.2" r="2.3" fill="#fff" />
          </svg>
          <span>ESXi Builder</span>
        </a>

        <Segmented
          size="small"
          value={page}
          onChange={(v) => navigate(v === 'storage' ? '/storage' : '/build')}
          options={[
            { value: 'build', label: <span className="seg-label"><DeploymentUnitOutlined /> 构建</span> },
            { value: 'storage', label: <span className="seg-label"><DatabaseOutlined /> 存储</span> },
          ]}
        />

        <a
          href="https://github.com/kos991/esxi-add"
          target="_blank"
          rel="noreferrer"
          aria-label="项目仓库"
          className="topbar-github"
        >
          <GithubOutlined />
        </a>
      </header>

      <main id="main-content" className="page-main" style={{ paddingTop: HEADER_HEIGHT + 16 }}>
        {children}
      </main>
    </ConfigProvider>
  )
}
