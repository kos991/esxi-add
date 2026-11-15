import { Space, Typography } from 'antd'
import type { ReactNode } from 'react'

/**
 * 原生 antd 页头：标题 / 副标题 / 右侧操作。
 * 不再依赖 @ant-design/pro-components 的 PageContainer。
 */
export function PageHeader({
  title,
  subTitle,
  extra,
}: {
  title: ReactNode
  subTitle?: ReactNode
  extra?: ReactNode
}) {
  return (
    <div className="page-header">
      <div className="page-header-main">
        <Typography.Title level={4} className="page-header-title">
          {title}
        </Typography.Title>
        {subTitle ? (
          <Typography.Text type="secondary" className="page-header-sub">
            {subTitle}
          </Typography.Text>
        ) : null}
      </div>
      {extra ? (
        <Space size={8} wrap className="page-header-extra">
          {extra}
        </Space>
      ) : null}
    </div>
  )
}
