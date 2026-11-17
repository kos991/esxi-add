import type { CSSProperties } from 'react'

type StepState = 'wait' | 'process' | 'finish' | 'error'

function stateClass(state: StepState) {
  if (state === 'process') return 'step-svg-active'
  if (state === 'finish') return 'step-svg-done'
  return 'step-svg-wait'
}

const baseStyle: CSSProperties = {
  display: 'block',
  overflow: 'visible',
}

/** 步骤 1：基础镜像（旋转光盘扫描弧 + 中心脉冲） */
export function StepDiscIcon({ state }: { state: StepState }) {
  return (
    <svg
      className={`step-svg ${stateClass(state)}`}
      viewBox="0 0 28 28"
      width="24"
      height="24"
      style={baseStyle}
      aria-hidden="true"
    >
      <circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.3" />
      <path
        className="step-svg-spin"
        d="M14 3a11 11 0 0 1 11 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        className="step-svg-spin-reverse"
        d="M14 25a11 11 0 0 1-11-11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.65"
      />
      <circle className="step-svg-pulse" cx="14" cy="14" r="3.2" fill="currentColor" />
    </svg>
  )
}

/** 步骤 2：驱动注入（芯片引脚 + 信号流动） */
export function StepDriverIcon({ state }: { state: StepState }) {
  return (
    <svg
      className={`step-svg ${stateClass(state)}`}
      viewBox="0 0 28 28"
      width="24"
      height="24"
      style={baseStyle}
      aria-hidden="true"
    >
      <rect x="7" y="7" width="14" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        className="step-svg-flow"
        d="M11 14h6M14 11v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="10"
      />
      <path
        d="M11 3v4M17 3v4M11 21v4M17 21v4M3 11h4M3 17h4M21 11h4M21 17h4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  )
}

/** 步骤 3：安装参数（动态调节滑块） */
export function StepParamIcon({ state }: { state: StepState }) {
  return (
    <svg
      className={`step-svg ${stateClass(state)}`}
      viewBox="0 0 28 28"
      width="24"
      height="24"
      style={baseStyle}
      aria-hidden="true"
    >
      <line x1="4" y1="8" x2="24" y2="8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.45" />
      <line x1="4" y1="14" x2="24" y2="14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.45" />
      <line x1="4" y1="20" x2="24" y2="20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.45" />
      <circle className="step-svg-slide-a" cx="10" cy="8" r="2.4" fill="currentColor" />
      <circle className="step-svg-slide-b" cx="18" cy="14" r="2.4" fill="currentColor" />
      <circle className="step-svg-slide-a" cx="12" cy="20" r="2.4" fill="currentColor" />
    </svg>
  )
}

/** 步骤 4：确认并运行（外环呼吸脉冲 + 播放三角） */
export function StepLaunchIcon({ state }: { state: StepState }) {
  return (
    <svg
      className={`step-svg ${stateClass(state)}`}
      viewBox="0 0 28 28"
      width="24"
      height="24"
      style={baseStyle}
      aria-hidden="true"
    >
      <circle className="step-svg-ring" cx="14" cy="14" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <polygon points="11.5,9.5 19.5,14 11.5,18.5" fill="currentColor" />
    </svg>
  )
}
