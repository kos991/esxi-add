import {
  BuildOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  FileZipOutlined,
  GithubOutlined,
  HistoryOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons'
import { ConfigProvider, Layout, Menu, Tooltip, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'
import { useState } from 'react'

const { Sider, Content, Footer } = Layout

const menuItems = [
  { key: '/', label: '总览', icon: <CloudServerOutlined /> },
  { key: '/buckets', label: '存储', icon: <DatabaseOutlined /> },
  { key: '/files', label: '文件库', icon: <FileZipOutlined /> },
  { key: '/build', label: '构建', icon: <BuildOutlined /> },
  { key: '/tasks', label: '日志', icon: <HistoryOutlined /> },
]

type AppShellProps = {
  pathname: string
  navigate: (path: string) => void
  children: ReactNode
}

function AnimatedLogo() {
  return (
    <div className="brand-logo" aria-label="ESXi ISO Builder">
      <svg className="brand-logo-svg" viewBox="0 0 40 40" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="brand-logo-gradient" x1="8" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ff9f2f" />
            <stop offset="0.58" stopColor="#ff6a00" />
            <stop offset="1" stopColor="#1769ff" />
          </linearGradient>
        </defs>
        <rect className="brand-logo-base" x="5" y="5" width="30" height="30" rx="8" />
        <path className="brand-logo-line" d="M13 14.5h9.5c2.8 0 5 2.2 5 5s-2.2 5-5 5H13" />
        <path className="brand-logo-line brand-logo-line-alt" d="M13 20h13" />
        <circle className="brand-logo-dot" cx="27" cy="20" r="2.6" />
      </svg>
    </div>
  )
}

export function AppShell({ pathname, navigate, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(true)
  const selectedPath = pathname.startsWith('/tasks/') ? '/tasks' : pathname
  const siderWidth = collapsed ? 80 : 208

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          colorInfo: '#1677ff',
          colorSuccess: '#00a870',
          colorWarning: '#ed7b2f',
          colorError: '#d54941',
          colorBgLayout: '#f4f6fb',
          colorText: '#1f2329',
          colorTextSecondary: '#5f6673',
          colorBorderSecondary: '#e7eaf0',
          borderRadius: 8,
          fontSize: 13,
          wireframe: false,
          lineHeight: 1.55,
          fontFamily:
            'Inter, "Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        components: {
          Layout: {
            bodyBg: '#f4f6fb',
            siderBg: '#ffffff',
          },
          Card: {
            headerBg: '#ffffff',
            borderRadiusLG: 8,
          },
          Menu: {
            itemBorderRadius: 6,
            itemHeight: 40,
            itemMarginInline: 10,
            itemSelectedBg: '#eaf3ff',
            itemSelectedColor: '#155bd4',
          },
          Table: {
            headerBg: '#f7f8fb',
            headerColor: '#4e5969',
            rowHoverBg: '#f7fbff',
          },
          Button: {
            borderRadius: 6,
          },
        },
        algorithm: theme.defaultAlgorithm,
      }}
    >
      <Layout hasSider className={`app-shell ant-pro-layout ${collapsed ? 'app-shell-collapsed' : 'app-shell-expanded'}`} style={{ minHeight: '100vh' }}>
        <Sider
          theme="light"
          trigger={null}
          collapsible
          collapsed={collapsed}
          width={208}
          className={`ant-pro-sider ${collapsed ? 'ant-pro-sider-collapsed' : ''}`}
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 100,
            borderRight: '1px solid #e8ebf2',
            boxShadow: '4px 0 18px rgba(31, 35, 41, 0.03)',
          }}
        >
          <div className="ant-pro-sider-logo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 58, borderBottom: '1px solid #eef0f5' }}>
            <AnimatedLogo />
          </div>
          <Menu
            mode="inline"
            selectedKeys={[selectedPath]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ borderRight: 0, paddingBlock: 8 }}
          />
          <div
            className="ant-pro-model-menu-footer"
            style={{
              position: 'absolute',
              bottom: 0,
              width: '100%',
              padding: '8px 0',
              borderTop: '1px solid #eef0f5',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <Tooltip title={collapsed ? '展开侧栏' : '收起侧栏'} placement="right">
              <div
                onClick={() => setCollapsed(!collapsed)}
                style={{
                  width: '40px',
                  height: '40px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  transition: 'background 0.3s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              </div>
            </Tooltip>
          </div>
        </Sider>
        <Layout
          className="app-main-layout"
          data-testid="app-main-layout"
          style={{
            marginLeft: siderWidth,
            width: `calc(100vw - ${siderWidth}px)`,
            maxWidth: `calc(100vw - ${siderWidth}px)`,
            minWidth: 0,
            transition: 'margin-left 0.2s, width 0.2s, max-width 0.2s',
            background: '#f4f6fb',
          }}
        >
          <Content className="ant-pro-layout-content" style={{ display: 'block', width: '100%' }}>
            <div className="app-content">{children}</div>
          </Content>
          <Footer className="app-footer">
            <div className="app-footer-links">
              <a href="https://github.com/kos991/esxi-add" target="_blank" rel="noreferrer">
                <GithubOutlined />
                <span>项目仓库</span>
              </a>
              <a href="https://preview.pro.ant.design/admin/sub-page" target="_blank" rel="noreferrer">
                Ant Design Pro
              </a>
            </div>
            <div className="app-footer-copy">Copyright © 2026 ESXi ISO Builder</div>
          </Footer>
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}
