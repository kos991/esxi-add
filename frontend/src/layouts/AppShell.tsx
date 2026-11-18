import {
  DatabaseOutlined,
  DeploymentUnitOutlined,
  GithubOutlined,
} from '../components/icons'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'

const HEADER_HEIGHT = 46

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
 * 顶部一行 1120px 居中对齐的 logo + 胶囊双页切换 + 仓库入口。
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
          borderRadius: 8,
          fontSize: 13,
          fontSizeSM: 12,
          fontSizeLG: 14,
          lineHeight: 1.5,
          controlHeight: 30,
          controlHeightSM: 24,
          fontFamily:
            'Inter, "Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        components: {
          Button: {
            contentFontSize: 12.5,
            contentFontSizeSM: 12,
            paddingInline: 11,
            paddingInlineSM: 8,
          },
          Card: {
            headerBg: '#ffffff',
            headerFontSize: 13.5,
            headerHeight: 42,
          },
          Segmented: { itemSelectedBg: '#ffffff' },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#475569',
            fontSize: 12.5,
            cellPaddingBlockSM: 8,
            cellPaddingInlineSM: 10,
            cellPaddingBlockMD: 9,
            cellPaddingInlineMD: 12,
          },
          Tag: {
            fontSizeSM: 11.5,
          },
          Steps: {
            titleLineHeight: 18,
            customIconSize: 20,
            customIconTop: 0,
            iconSizeSM: 20,
          },
          Input: {
            inputFontSize: 12.5,
          },
          Descriptions: {
            fontSize: 12.5,
          },
        },
        algorithm: theme.defaultAlgorithm,
      }}
    >
      <a href="#main-content" className="skip-link">
        跳到主要内容
      </a>

      <header className="topbar">
        <div className="topbar-inner">
          <a
            className="topbar-brand"
            href="/build"
            onClick={(e) => {
              e.preventDefault()
              navigate('/build')
            }}
          >
            <svg viewBox="0 0 40 40" width="22" height="22" aria-hidden="true">
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

          <nav className="topnav-segmented" aria-label="主导航">
            <a
              href="/build"
              className="topnav-link"
              aria-current={page === 'build' ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault()
                navigate('/build')
              }}
            >
              <DeploymentUnitOutlined aria-hidden="true" />
              <span>构建流水线</span>
            </a>
            <a
              href="/storage"
              className="topnav-link"
              aria-current={page === 'storage' ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault()
                navigate('/storage')
              }}
            >
              <DatabaseOutlined aria-hidden="true" />
              <span>存储与挂载</span>
            </a>
          </nav>

          <a
            href="https://github.com/kos991/esxi-add"
            target="_blank"
            rel="noreferrer"
            aria-label="项目仓库"
            className="topbar-github"
          >
            <GithubOutlined aria-hidden="true" />
          </a>
        </div>
      </header>

      <main id="main-content" className="page-main" style={{ paddingTop: HEADER_HEIGHT + 14 }}>
        {children}
      </main>
    </ConfigProvider>
  )
}
