import {
  DashboardOutlined,
  DeploymentUnitOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  GithubOutlined,
  HddOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons'
import { Button, ConfigProvider, Layout, Menu, Tooltip, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'
import { useState } from 'react'

const { Header, Sider, Content, Footer } = Layout
const SIDER_WIDTH = 212
const SIDER_COLLAPSED_WIDTH = 72
const HEADER_HEIGHT = 56

const menuItems = [
  { key: '/', label: '总览', icon: <DashboardOutlined /> },
  { key: '/buckets', label: '存储节点', icon: <HddOutlined /> },
  { key: '/files', label: '文件库', icon: <FolderOpenOutlined /> },
  { key: '/build', label: '构建流水线', icon: <DeploymentUnitOutlined /> },
  { key: '/tasks', label: '任务日志', icon: <FileSearchOutlined /> },
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
      <div className="brand-logo-text">
        <strong>ESXi Builder</strong>
        <span>build console</span>
      </div>
    </div>
  )
}

export function AppShell({ pathname, navigate, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(true)
  const selectedPath = pathname.startsWith('/tasks/') ? '/tasks' : pathname
  const siderWidth = collapsed ? SIDER_COLLAPSED_WIDTH : SIDER_WIDTH

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          colorInfo: '#2563eb',
          colorSuccess: '#00a870',
          colorWarning: '#ed7b2f',
          colorError: '#d54941',
          colorBgLayout: '#f7f9fc',
          colorText: '#0f172a',
          colorTextSecondary: '#64748b',
          colorBorderSecondary: '#e7eaf0',
          borderRadius: 8,
          borderRadiusLG: 8,
          fontSize: 13,
          lineHeight: 1.55,
          fontFamily:
            'Inter, "Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        components: {
          Layout: {
            bodyBg: '#f7f9fc',
            footerBg: '#f7f9fc',
            lightSiderBg: '#ffffff',
            lightTriggerBg: '#ffffff',
            lightTriggerColor: '#0f172a',
          },
          Card: {
            headerBg: '#ffffff',
          },
          Menu: {
            itemBorderRadius: 6,
            itemHeight: 42,
            itemMarginInline: 12,
            itemSelectedBg: '#eff6ff',
            itemSelectedColor: '#1d4ed8',
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
        <Header className="app-header">
          <AnimatedLogo />
          <div className="app-header-tools">
            <a href="https://github.com/kos991/esxi-add" target="_blank" rel="noreferrer" aria-label="项目仓库">
              <GithubOutlined />
            </a>
            <span>ESXi Builder</span>
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
            left: 0,
            top: HEADER_HEIGHT,
            bottom: 0,
            zIndex: 100,
            borderRight: '1px solid #e8ebf2',
            boxShadow: '4px 0 18px rgba(31, 35, 41, 0.03)',
          }}
        >
          <Menu
            mode="inline"
            selectedKeys={[selectedPath]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ borderRight: 0, paddingBlock: 8 }}
          />
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
            width: `calc(100vw - ${siderWidth}px)`,
            maxWidth: `calc(100vw - ${siderWidth}px)`,
            minWidth: 0,
            marginTop: HEADER_HEIGHT,
            transition: 'margin-left 0.2s, width 0.2s, max-width 0.2s',
            background: '#f7f9fc',
          }}
        >
          <Content className="ant-pro-layout-content" style={{ display: 'block', width: '100%' }}>
            <div className="app-content">{children}</div>
          </Content>
          <Footer className="app-footer">
            <div className="app-footer-copy">Copyright © 2026 ESXi ISO Builder</div>
          </Footer>
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}
