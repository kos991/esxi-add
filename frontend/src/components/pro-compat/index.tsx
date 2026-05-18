import { Card, Statistic, Space } from 'antd'
import React from 'react'

interface ProCardProps {
  title?: React.ReactNode
  extra?: React.ReactNode
  bordered?: boolean
  ghost?: boolean
  headerBordered?: boolean
  bodyStyle?: React.CSSProperties
  className?: string
  size?: 'default' | 'small'
  children?: React.ReactNode
  style?: React.CSSProperties
  split?: 'vertical' | 'horizontal'
  colSpan?: string | number
}

export const ProCard: React.FC<ProCardProps> & { Group: React.FC<{ children: React.ReactNode; className?: string }> } = ({
  title,
  extra,
  bordered = true,
  ghost = false,
  headerBordered = false,
  bodyStyle,
  className = '',
  size,
  children,
  style,
  split,
  colSpan,
}) => {
  const cardStyle: React.CSSProperties = { ...style }
  if (colSpan) {
    cardStyle.flex = typeof colSpan === 'string' && colSpan.endsWith('%') ? `0 0 ${colSpan}` : colSpan
  }

  if (ghost) {
    return (
      <div className={`ant-pro-card ${className}`} style={cardStyle}>
        <div className="ant-pro-card-body" style={bodyStyle}>
          {children}
        </div>
      </div>
    )
  }

  if (split === 'vertical') {
    return (
      <div className={`ant-pro-card ant-pro-card-split-vertical ${className}`} style={{ display: 'flex', ...cardStyle, border: bordered ? '1px solid #e8ebf2' : 'none', borderRadius: 8 }}>
        {children}
      </div>
    )
  }

  return (
    <Card
      title={title}
      extra={extra}
      bordered={bordered}
      bodyStyle={bodyStyle}
      className={`ant-pro-card ${className} ${headerBordered ? 'ant-pro-card-header-bordered' : ''}`}
      classNames={{
        body: 'ant-pro-card-body',
        header: 'ant-pro-card-header',
        title: 'ant-pro-card-title',
      }}
      size={size}
      style={cardStyle}
      headStyle={headerBordered ? { borderBottom: '1px solid #edf0f5' } : undefined}
    >
      {children}
    </Card>
  )
}

ProCard.Group = ({ children, className = '' }) => {
  return (
    <div className={`ant-pro-card-group ${className}`} style={{ display: 'flex', gap: 16, width: '100%', marginBottom: 16 }}>
      {children}
    </div>
  )
}

interface PageContainerProps {
  title?: React.ReactNode
  subTitle?: React.ReactNode
  extra?: React.ReactNode[]
  children?: React.ReactNode
}

export const PageContainer: React.FC<PageContainerProps> = ({ title, subTitle, extra, children }) => {
  return (
    <div className="ant-pro-page-container">
      <div className="ant-pro-page-container-warp-page-header">
        <div className="ant-page-header">
          <div className="ant-page-header-heading">
            <div className="ant-page-header-heading-left">
              <span className="ant-page-header-heading-title">{title}</span>
              {subTitle && <span className="ant-page-header-heading-sub-title">{subTitle}</span>}
            </div>
            <div className="ant-page-header-heading-extra">
              <Space>{extra}</Space>
            </div>
          </div>
        </div>
      </div>
      <div className="ant-pro-page-container-children-container">
        {children}
      </div>
    </div>
  )
}

interface StatisticCardProps {
  statistic?: {
    title?: React.ReactNode
    value?: React.ReactNode
    icon?: React.ReactNode
  }
}

export const StatisticCard: React.FC<StatisticCardProps> & { Group: React.FC<{ children: React.ReactNode; className?: string }> } = ({
  statistic,
}) => {
  return (
    <Card
      className="ant-pro-card"
      classNames={{
        body: 'ant-pro-card-body',
      }}
      style={{ flex: 1 }}
    >
      <Statistic
        title={statistic?.title}
        value={statistic?.value as any}
        prefix={statistic?.icon}
      />
    </Card>
  )
}

StatisticCard.Group = ProCard.Group
