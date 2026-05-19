# Ant Design Pro V6 UI 方案

这是一套偏 Ant Design Pro 的后台控制台 UI 方案，适合工具台、运维后台、构建流水线、文件管理、任务日志类项目。目标是白色、干净、可扫描，默认窄侧栏，页面主体使用 Ant Design V6 原生组件。

## 依赖

```json
{
  "antd": "^6.4.3",
  "@ant-design/icons": "^6.2.3",
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "react-router-dom": "^6.22.3"
}
```

## 总体布局

- 顶部固定白色 Header，高度 `56px`。
- Logo 放在 Header 左侧，不放在侧栏里。
- 左侧 Sider 从 Header 下方开始，固定定位。
- 侧栏默认收起，宽度 `72px`；展开宽度 `212px`。
- 折叠按钮使用圆形浮动按钮，贴在侧栏右边缘。
- 内容区根据侧栏宽度自动计算：

```ts
const SIDER_WIDTH = 212
const SIDER_COLLAPSED_WIDTH = 72
const HEADER_HEIGHT = 56

const [collapsed, setCollapsed] = useState(true)
const siderWidth = collapsed ? SIDER_COLLAPSED_WIDTH : SIDER_WIDTH
```

```tsx
<Layout
  style={{
    marginLeft: siderWidth,
    width: `calc(100vw - ${siderWidth}px)`,
    maxWidth: `calc(100vw - ${siderWidth}px)`,
    marginTop: HEADER_HEIGHT,
    minWidth: 0,
    transition: 'margin-left 0.2s, width 0.2s, max-width 0.2s',
  }}
>
  <Content>
    <div className="app-content">{children}</div>
  </Content>
</Layout>
```

## 主题 Token

```tsx
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
```

## 侧栏图标建议

```tsx
import {
  DashboardOutlined,
  DeploymentUnitOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  HddOutlined,
} from '@ant-design/icons'

const menuItems = [
  { key: '/', label: '总览', icon: <DashboardOutlined /> },
  { key: '/storage', label: '存储节点', icon: <HddOutlined /> },
  { key: '/files', label: '文件库', icon: <FolderOpenOutlined /> },
  { key: '/pipeline', label: '构建流水线', icon: <DeploymentUnitOutlined /> },
  { key: '/tasks', label: '任务日志', icon: <FileSearchOutlined /> },
]
```

原则：图标尽量表达页面对象，不用抽象图标堆砌。菜单默认只显示图标，展开后显示文字。

## Header 与侧栏样式

```css
.app-header {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 120;
  display: flex;
  height: 56px;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px 0 16px;
  border-bottom: 1px solid #eef0f5;
  background: #fff;
}

.app-content {
  min-height: 100vh;
  width: 100%;
  padding: 26px 32px 0;
  overflow-x: hidden;
}

.ant-pro-layout .ant-pro-sider {
  border-right: 1px solid #e8ebf2;
  box-shadow: 4px 0 18px rgba(31, 35, 41, 0.03);
}

.ant-pro-layout .ant-menu-item {
  font-size: 13px;
  font-weight: 500;
}

.ant-pro-model-menu-footer {
  position: absolute;
  top: 18px;
  right: -13px;
  z-index: 2;
}

.ant-pro-model-menu-footer .ant-btn {
  width: 26px;
  height: 26px;
  min-width: 26px;
  border: 1px solid #eef0f5;
  border-radius: 999px;
  background: #fff;
  color: #86909c;
  box-shadow: 0 4px 14px rgba(31, 35, 41, 0.08);
}
```

## Logo 方案

用小尺寸动态图标即可，不要做大面积品牌区。Logo 在 Header 左侧，收起侧栏时不影响品牌识别。

```tsx
function AnimatedLogo() {
  return (
    <div className="brand-logo" aria-label="Project Console">
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
        <strong>Project Name</strong>
        <span>console</span>
      </div>
    </div>
  )
}
```

```css
.brand-logo {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.brand-logo-svg {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
}

.brand-logo-base {
  fill: url("#brand-logo-gradient");
}

.brand-logo-line {
  fill: none;
  stroke: #fff;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 34;
  animation: brand-line 2.6s ease-in-out infinite;
}

.brand-logo-dot {
  fill: #fff;
  transform-origin: 27px 20px;
  animation: brand-dot 1.8s ease-in-out infinite;
}

@keyframes brand-line {
  0%, 100% { stroke-dashoffset: 0; opacity: 0.92; }
  50% { stroke-dashoffset: 9; opacity: 1; }
}

@keyframes brand-dot {
  0%, 100% { transform: scale(1); opacity: 0.86; }
  50% { transform: scale(1.28); opacity: 1; }
}
```

## 页面布局模式

业务页面推荐三种模式：

1. 表格页：`Card + Table + toolbar`，不要把表格套进多层卡片。
2. 表单流程页：`Watermark + Steps type="navigation" + Card + 右侧摘要`。
3. 详情/日志页：左侧列表，右侧详情和日志，使用 `Descriptions`、`Alert`、`Progress`、`Tag`。

## 构建/向导页模式

```tsx
<Watermark
  className="build-watermark"
  content={['Project Name', 'Console']}
  font={{ color: 'rgba(15, 23, 42, 0.045)', fontSize: 15, fontWeight: 500 }}
  gap={[180, 120]}
  rotate={-18}
>
  <div className="build-workbench">
    <div className="build-main">
      <Card className="build-step-nav-card">
        <Steps type="navigation" current={step} items={stepItems} onChange={goToStep} />
      </Card>

      <Card className="build-stage-card" title="当前步骤">
        {stepContent}
      </Card>

      <Card className="build-actions-card" size="small">
        {actions}
      </Card>
    </div>

    <Card className="build-summary-card" title="当前配置" variant="outlined">
      <Descriptions column={1} size="small" items={summaryItems} />
    </Card>
  </div>
</Watermark>
```

```css
.build-watermark {
  display: block;
  width: 100%;
  min-height: calc(100vh - 122px);
}

.build-workbench {
  display: grid;
  width: min(100%, 1260px);
  gap: 16px;
  grid-template-columns: minmax(0, 1fr) clamp(300px, 25vw, 340px);
  align-items: start;
}

.build-main {
  display: grid;
  min-width: 0;
  gap: 16px;
}

.build-summary-card {
  position: sticky;
  top: 18px;
  min-width: 0;
}

.build-navigation-steps .ant-steps-item-title,
.build-navigation-steps .ant-steps-item-description {
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1180px) {
  .build-workbench {
    width: 100%;
    grid-template-columns: 1fr;
  }

  .build-summary-card {
    position: static;
    order: -1;
  }
}

@media (max-width: 768px) {
  .build-navigation-steps.ant-steps-navigation {
    display: grid;
    gap: 8px;
  }

  .build-navigation-steps.ant-steps-navigation .ant-steps-item {
    width: 100%;
    margin-inline-start: 0;
    padding-inline: 8px;
  }
}
```

## 组件使用约定

- 用 `Steps type="navigation"` 做流程，不自绘步骤条。
- 用 `Watermark` 做低强度背景识别，不用渐变球或大装饰。
- 用 `Descriptions` 做当前配置摘要。
- 用 `Table rowSelection` 做批量选择，不自绘表格复选交互。
- 用 `Alert title`，不用旧的 `message` 写法。
- 用 `Space orientation="vertical"`，不用旧的 `direction` 写法。
- 用 `Card variant="outlined"` 和 `styles`，不要传旧 `bordered/bodyStyle/headStyle` 给 AntD Card。
- 空按钮必须禁用或隐藏，不能放一个点了没反应的按钮。

## 字体与密度

- 全局字号 `13px`，后台工具更适合紧凑但不拥挤。
- 页面标题 `28px`，卡片标题 `13px/700`。
- 卡片圆角 6-8px，不做大圆角。
- 表格行 padding 控制在 `7px 12px`，方便扫描。
- 背景色用 `#f7f9fc`，卡片白色，边框 `#e8ebf2`。

## 可迁移文件清单

从本项目迁移时，重点看这些文件：

- `frontend/src/layouts/AppShell.tsx`
- `frontend/src/index.css`
- `frontend/src/pages/BuildPage.tsx`
- `frontend/src/components/pro-compat/index.tsx`
- `frontend/src/test/setup.ts`

截图参考：

- `docs/images/current-build-ui-pro-shell.png`
- `docs/images/current-build-ui-auto-layout.png`
- `docs/images/current-build-ui-auto-layout-mobile.png`
- `docs/images/ant-design-pro-welcome-reference.png`

## 迁移步骤

1. 升级 `antd` 到 V6，`@ant-design/icons` 到 V6。
2. 引入 `ConfigProvider`，复制主题 token。
3. 建立 `AppShell`：固定 Header、默认收起 Sider、内容区动态宽度。
4. 替换侧栏图标，菜单只保留 5-7 个一级入口。
5. 页面统一使用 `Card/Table/Descriptions/Steps/Watermark/Alert/Tag/Progress`。
6. 清理旧 API：`Space direction`、`Alert message`、`Card bodyStyle/headStyle/bordered`。
7. 跑 `npm run test` 和 `npm run build`，再用浏览器截图检查桌面和窄屏。

