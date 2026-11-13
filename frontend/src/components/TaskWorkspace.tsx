import { ClockCircleOutlined } from './icons'
import { Progress, Space, Tag, Tooltip, Typography } from 'antd'
import { useMemo } from 'react'

export interface TimingPhaseItem {
  key: string
  label: string
  color: string
  desc: string
  ms: number
  seconds: string
  percent: number
}

export const TIMING_PHASE_DEFS: { key: string; aliasKeys?: string[]; label: string; color: string; desc: string }[] = [
  { key: 'input_prepare_ms', label: '输入准备', color: '#0d9488', desc: '源文件定位与输入校验' },
  { key: 'iso_extract_ms', label: '基础镜像解包', color: '#0284c7', desc: '解包 ISO9660 与引导目录树' },
  { key: 'powercli_load_ms', label: 'PowerCLI 初始化', color: '#2563eb', desc: 'ImageBuilder 运行时加载' },
  { key: 'depot_profile_ms', label: 'Depot & Profile', color: '#7c3aed', desc: '加载 Depot 与克隆镜像配置' },
  { key: 'driver_injection_ms', aliasKeys: ['driver_inject_ms'], label: '驱动与参数注入', color: '#ea580c', desc: '注入驱动包与无人值守/Root 参数' },
  { key: 'iso_export_ms', aliasKeys: ['iso_rebuild_ms'], label: 'ISO 镜像封装', color: '#db2777', desc: '重封装可引导 UEFI/BIOS ISO 镜像' },
  { key: 'artifact_persist_ms', label: '产物校验入库', color: '#16a34a', desc: '流式 SHA-256 计算与落盘持久化' },
]

export function parseTimingMetrics(logs: string[]): Record<string, number> {
  const metrics: Record<string, number> = {}
  for (const line of logs) {
    const match = line.match(/\[TIMING\]\s+([a-zA-Z0-9_]+)=(\d+)/)
    if (match) {
      metrics[match[1]] = parseInt(match[2], 10)
    }
  }
  return metrics
}

export function PhaseTimingBreakdown({
  logs,
  buildDuration,
  isCompleted,
}: {
  logs: string[]
  buildDuration?: number
  isCompleted?: boolean
}) {
  const metrics = useMemo(() => parseTimingMetrics(logs), [logs])

  const phases = useMemo(() => {
    const present: TimingPhaseItem[] = []
    let sumMs = 0

    for (const def of TIMING_PHASE_DEFS) {
      let rawMs: number | undefined = metrics[def.key]
      if (typeof rawMs !== 'number' && def.aliasKeys) {
        for (const alias of def.aliasKeys) {
          if (typeof metrics[alias] === 'number') {
            rawMs = metrics[alias]
            break
          }
        }
      }

      if (typeof rawMs === 'number') {
        sumMs += rawMs
        present.push({
          key: def.key,
          label: def.label,
          color: def.color,
          desc: def.desc,
          ms: rawMs,
          seconds: (rawMs / 1000).toFixed(2),
          percent: 0,
        })
      }
    }

    const baseMs = sumMs > 0 ? sumMs : 1
    for (const p of present) {
      p.percent = Math.min(100, Math.round((p.ms / baseMs) * 1000) / 10)
    }

    return {
      items: present,
      sumMs,
      totalSeconds: (sumMs / 1000).toFixed(2),
      hasMetrics: present.length > 0,
    }
  }, [metrics])

  if (!phases.hasMetrics && !isCompleted) {
    return null
  }

  return (
    <div
      className="phase-timing-card"
      data-testid="phase-timing-card"
    >
      <div className="phase-timing-header">
        <Space size={8} align="center">
          <ClockCircleOutlined style={{ color: '#2563eb', fontSize: 15 }} />
          <Typography.Text strong style={{ fontSize: 13 }}>
            阶段耗时分解
          </Typography.Text>
          {phases.hasMetrics && (
            <Tag color="blue" style={{ borderRadius: 999, paddingInline: 8, fontSize: 11, marginInlineEnd: 0 }}>
              {phases.items.length} 个阶段
            </Tag>
          )}
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          阶段累计：
          <Typography.Text strong className="mono tabular-nums" style={{ color: '#0f172a' }}>
            {phases.totalSeconds}s
          </Typography.Text>
        </Typography.Text>
      </div>

      {phases.hasMetrics ? (
        <>
          <div className="phase-stacked-bar" role="img" aria-label="阶段耗时占比条">
            {phases.items.map((phase) => (
              <Tooltip
                key={phase.key}
                title={`${phase.label}：${phase.seconds}s (${phase.percent}%) · ${phase.desc}`}
              >
                <div
                  style={{
                    width: `${Math.max(phase.percent, phase.ms > 0 ? 2 : 0)}%`,
                    backgroundColor: phase.color,
                    transition: 'width 0.35s ease',
                  }}
                />
              </Tooltip>
            ))}
          </div>

          <div className="phase-rows">
            {phases.items.map((phase) => (
              <div key={phase.key} className="phase-row">
                <div className="phase-row-label">
                  <span className="phase-dot" style={{ backgroundColor: phase.color }} />
                  <Tooltip title={phase.desc}>
                    <Typography.Text style={{ fontSize: 12, fontWeight: 500 }}>
                      {phase.label}
                    </Typography.Text>
                  </Tooltip>
                </div>
                <div className="phase-row-bar">
                  <Progress
                    percent={phase.percent}
                    strokeColor={phase.color}
                    size="small"
                    showInfo={false}
                    railColor="#eef2f6"
                  />
                </div>
                <div className="phase-row-sec mono tabular-nums">
                  {phase.seconds}s
                </div>
                <div className="phase-row-pct mono tabular-nums">
                  {phase.percent}%
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          该任务未记录细分阶段指标（构建总耗时：{buildDuration ?? 0} 秒）
        </Typography.Text>
      )}
    </div>
  )
}
