import {
  BuildOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  FileZipOutlined,
  GithubOutlined,
  HistoryOutlined,
} from '@ant-design/icons'
import { ProLayout } from '@ant-design/pro-components'
import { ConfigProvider, Tooltip, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'
import { useState } from 'react'

const menuRoutes = [
  { path: '/', name: '总览', icon: <CloudServerOutlined /> },
  { path: '/buckets', name: '存储', icon: <DatabaseOutlined /> },
  { path: '/files', name: '文件库', icon: <FileZipOutlined /> },
  { path: '/build', name: '构建', icon: <BuildOutlined /> },
  { path: '/tasks', name: '日志', icon: <HistoryOutlined /> },
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
      <ProLayout
        className={`app-shell ${collapsed ? 'app-shell-collapsed' : 'app-shell-expanded'}`}
        title={false}
        logo={<AnimatedLogo />}
        route={{ path: '/', routes: menuRoutes }}
        location={{ pathname: selectedPath }}
        headerRender={false}
        fixedHeader={false}
        fixSiderbar
        layout="side"
        navTheme="light"
        siderWidth={208}
        breakpoint={false}
        collapsed={collapsed}
        onCollapse={setCollapsed}
        collapsedButtonRender={(isCollapsed, defaultDom) => (
          <Tooltip title={isCollapsed ? '展开侧栏' : '收起侧栏'} placement="right">
            {defaultDom}
          </Tooltip>
        )}
        menuItemRender={(item, dom) => (
          <a
            href={item.path}
            onClick={(event) => {
              event.preventDefault()
              if (item.path) navigate(item.path)
            }}
          >
            {dom}
          </a>
        )}
        contentStyle={{
          minHeight: '100vh',
          paddingBlock: 0,
          paddingInline: 0,
          background: '#f4f6fb',
        }}
        footerRender={() => (
          <footer className="app-footer">
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
          </footer>
        )}
      >
        <div className="app-content">{children}</div>
      </ProLayout>
    </ConfigProvider>
  )
}
