import { Card, Statistic, Space } from 'antd'
import type { CardProps } from 'antd'
import React from 'react'

type CardSemanticClassNames = {
  root?: string
  header?: string
  body?: string
  extra?: string
  title?: string
  actions?: string
  cover?: string
}

type CardSemanticStyles = {
  root?: React.CSSProperties
  header?: React.CSSProperties
  body?: React.CSSProperties
  extra?: React.CSSProperties
  title?: React.CSSProperties
  actions?: React.CSSProperties
  cover?: React.CSSProperties
}

interface ProCardProps {
  title?: React.ReactNode
  extra?: React.ReactNode
  variant?: CardProps['variant']
  bordered?: boolean
  ghost?: boolean
  headerBordered?: boolean
  bodyStyle?: React.CSSProperties
  className?: string
  classNames?: CardSemanticClassNames
  size?: CardProps['size']
  children?: React.ReactNode
  style?: React.CSSProperties
  styles?: CardSemanticStyles
  split?: 'vertical' | 'horizontal'
  colSpan?: string | number
}

function mergeClassNames(...names: Array<string | undefined>) {
  return names.filter(Boolean).join(' ')
}

function mergeStyles(...styles: Array<React.CSSProperties | undefined>) {
  const merged = Object.assign({}, ...styles.filter(Boolean))
  return Object.keys(merged).length > 0 ? merged : undefined
}

export const ProCard: React.FC<ProCardProps> & { Group: React.FC<{ children: React.ReactNode; className?: string }> } = ({
  title,
  extra,
  variant,
  bordered = true,
  ghost = false,
  headerBordered = false,
  bodyStyle,
  className = '',
  classNames,
  size,
  children,
  style,
  styles,
  split,
  colSpan,
}) => {
  const cardStyle: React.CSSProperties = { ...style }
  const bodyStyles = mergeStyles(bodyStyle, styles?.body)
  const headerStyles = mergeStyles(styles?.header, headerBordered ? { borderBottom: '1px solid #edf0f5' } : undefined)

  if (colSpan) {
    cardStyle.flex = typeof colSpan === 'string' && colSpan.endsWith('%') ? `0 0 ${colSpan}` : colSpan
  }

  if (ghost) {
    return (
      <div className={mergeClassNames('ant-pro-card', className, classNames?.root)} style={cardStyle}>
        <div className={mergeClassNames('ant-pro-card-body', classNames?.body)} style={bodyStyles}>
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
      variant={variant ?? (bordered ? 'outlined' : 'borderless')}
      className={`ant-pro-card ${className} ${headerBordered ? 'ant-pro-card-header-bordered' : ''}`}
      classNames={{
        ...classNames,
        body: mergeClassNames('ant-pro-card-body', classNames?.body),
        header: mergeClassNames('ant-pro-card-header', classNames?.header),
        title: mergeClassNames('ant-pro-card-title', classNames?.title),
      }}
      size={size}
      style={cardStyle}
      styles={{
        ...styles,
        body: bodyStyles,
        header: headerStyles,
      }}
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
