import {
  CloudServerOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  GithubOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ThunderboltOutlined,
} from '../components/icons'
import { Button, ConfigProvider, Layout, Menu, Space, Tag, Tooltip, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

const { Header, Sider, Content, Footer } = Layout
const SIDER_WIDTH = 216
const SIDER_COLLAPSED_WIDTH = 72
const HEADER_HEIGHT = 56

// 严格精简为用户要求的 2 大核心页面
const menuItems = [
  { key: '/build', label: '构建流水线', icon: <DeploymentUnitOutlined /> },
  { key: '/storage', label: '存储与挂载', icon: <DatabaseOutlined /> },
]

type AppShellProps = {
  pathname: string
  navigate: (path: string) => void
  children: ReactNode
}

function resolveSelectedMenuKey(pathname: string): string {
  if (pathname.startsWith('/storage') || pathname.startsWith('/buckets') || pathname.startsWith('/files')) {
    return '/storage'
  }
  return '/build'
}

function AnimatedLogo({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="brand-logo brand-logo-btn"
      aria-label="ESXi ISO Builder"
      onClick={onClick}
    >
      <svg className="brand-logo-svg" viewBox="0 0 40 40" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="brand-logo-gradient" x1="8" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
            <stop stopColor="#2563eb" />
            <stop offset="0.55" stopColor="#0ea5e9" />
            <stop offset="1" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <rect className="brand-logo-base" x="4" y="4" width="32" height="32" rx="9" />
        <path className="brand-logo-line" d="M13 14.5h9.5c2.8 0 5 2.2 5 5s-2.2 5-5 5H13" />
        <path className="brand-logo-line brand-logo-line-alt" d="M13 20h13" />
        <circle className="brand-logo-dot" cx="27.5" cy="20" r="2.6" />
      </svg>
      <div className="brand-logo-text">
        <strong>ESXi ISO Builder</strong>
        <span>极速构建流水线</span>
      </div>
    </button>
  )
}

export function AppShell({ pathname, navigate, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 900)

  useEffect(() => {
    let narrow = window.innerWidth < 900
    const onResize = () => {
      const nowNarrow = window.innerWidth < 900
      if (nowNarrow !== narrow) {
        narrow = nowNarrow
        setCollapsed(nowNarrow)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const selectedPath = resolveSelectedMenuKey(pathname)
  const siderWidth = collapsed ? SIDER_COLLAPSED_WIDTH : SIDER_WIDTH

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          colorInfo: '#2563eb',
          colorSuccess: '#059669',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          colorBgLayout: '#f4f7fb',
          colorText: '#0f172a',
          colorTextSecondary: '#64748b',
          colorBorderSecondary: '#e2e8f0',
          borderRadius: 10,
          borderRadiusLG: 12,
          fontSize: 13,
          lineHeight: 1.55,
          fontFamily:
            'Inter, "Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        components: {
          Layout: {
            bodyBg: '#f4f7fb',
            footerBg: '#f4f7fb',
            lightSiderBg: '#ffffff',
            lightTriggerBg: '#ffffff',
            lightTriggerColor: '#0f172a',
          },
          Card: {
            headerBg: '#ffffff',
          },
          Menu: {
            itemBorderRadius: 8,
            itemHeight: 44,
            itemMarginInline: 10,
            itemSelectedBg: '#eff6ff',
            itemSelectedColor: '#1d4ed8',
          },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#475569',
            rowHoverBg: '#f8fbff',
          },
          Button: {
            borderRadius: 8,
          },
        },
        algorithm: theme.defaultAlgorithm,
      }}
    >
      <a href="#main-content" className="skip-link">
        跳到主要内容
      </a>
      <Layout
        hasSider
        className={`app-shell ant-pro-layout ${collapsed ? 'app-shell-collapsed' : 'app-shell-expanded'}`}
        style={{ minHeight: '100dvh' }}
      >
        <Header className="app-header">
          <AnimatedLogo onClick={() => navigate('/build')} />
          <div className="app-header-tools">
            <Tag color="processing" className="header-engine-tag">
              <ThunderboltOutlined /> Linux 原生重封装 (5~10 秒)
            </Tag>
            <Space size={10}>
              <a
                href="https://github.com/kos991/esxi-add"
                target="_blank"
                rel="noreferrer"
                aria-label="项目仓库"
                className="header-github-link"
              >
                <GithubOutlined />
              </a>
            </Space>
          </div>
        </Header>

        <Sider
          theme="light"
          trigger={null}
          collapsible
          collapsed={collapsed}
          width={SIDER_WIDTH}
          collapsedWidth={SIDER_COLLAPSED_WIDTH}
          className={`ant-pro-sider ${collapsed ? 'ant-pro-sider-collapsed' : ''}`}
          style={{
            position: 'fixed',
            insetInlineStart: 0,
            insetBlockStart: HEADER_HEIGHT,
            insetBlockEnd: 0,
            zIndex: 100,
            borderInlineEnd: '1px solid #e2e8f0',
            boxShadow: '4px 0 20px rgba(15, 23, 42, 0.03)',
          }}
        >
          <nav aria-label="主导航">
            <Menu
              mode="inline"
              selectedKeys={[selectedPath]}
              items={menuItems}
              onClick={({ key }) => navigate(key)}
              style={{ borderInlineEnd: 0, paddingBlock: 12 }}
            />
          </nav>
          <div className="ant-pro-model-menu-footer">
            <Tooltip title={collapsed ? '展开侧栏' : '收起侧栏'} placement="right">
              <Button
                aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
              />
            </Tooltip>
          </div>
        </Sider>

        <Layout
          className="app-main-layout"
          data-testid="app-main-layout"
          style={{
            marginLeft: siderWidth,
            width: `calc(100% - ${siderWidth}px)`,
            minWidth: 0,
            marginTop: HEADER_HEIGHT,
            transition: 'margin-left 0.2s ease, width 0.2s ease',
            background: '#f4f7fb',
          }}
        >
          <Content id="main-content" className="ant-pro-layout-content" style={{ display: 'block', width: '100%' }}>
            <div className="app-content">{children}</div>
          </Content>
          <Footer className="app-footer">
            <div className="app-footer-copy">ESXi ISO Builder · 构建流水线 / 本地与 S3 存储挂载</div>
          </Footer>
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}
