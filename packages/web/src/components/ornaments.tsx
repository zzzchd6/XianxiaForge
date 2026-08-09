import React from 'react'
import { cn } from '../lib/utils'

/**
 * 指尖仙侠 · 装饰纹样组件库（黑金云纹版）
 * 全部为低透明度鎏金线稿，currentColor 继承父级颜色，克制不抢内容。
 * 纹样：祥云(卷云) / 角隅(角花) / 回纹 / 远山云影。
 */

interface OrnamentProps {
  className?: string
}

/** 祥云（卷云纹，线稿）。默认尺寸需外部约束。 */
export function Cloud({ className }: OrnamentProps) {
  return (
    <svg viewBox="0 0 100 44" fill="none" aria-hidden="true" className={cn('block', className)}>
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M72 26 a14 14 0 1 1 -28 0 a10 10 0 1 1 20 0 a6 6 0 1 1 -12 0 a3 3 0 1 1 6 0" />
        <path d="M72 26 C 82 26, 88 28, 97 27" />
        <path d="M44 26 C 33 24, 24 28, 14 26 C 9 25, 5 27, 2 26" />
      </g>
    </svg>
  )
}

/** 角隅纹样（双线角花 + 一点），默认朝左上，其余角用 rotate 复用。 */
export function Corner({ className }: OrnamentProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cn('block', className)}>
      <g stroke="currentColor">
        <path d="M1 19 V7 Q1 1 7 1 H19" strokeWidth="1.4" />
        <path d="M5 19 V10 Q5 5 10 5 H19" strokeWidth="0.9" opacity="0.7" />
      </g>
      <circle cx="9.5" cy="9.5" r="1.2" fill="currentColor" />
    </svg>
  )
}

/** 回纹单元（单个 key-fret）。 */
function MeanderUnit() {
  return <path d="M1 9 H20 V1 H8 V6 H14" fill="none" stroke="currentColor" strokeWidth="1.2" />
}

/** 回纹细带：水平重复 n 个单元，用于品牌名下方等窄带装饰。 */
export function Meander({ className, units = 8 }: OrnamentProps & { units?: number }) {
  return (
    <svg
      viewBox={`0 0 ${units * 24} 10`}
      fill="none"
      aria-hidden="true"
      className={cn('block', className)}
      preserveAspectRatio="none"
    >
      {Array.from({ length: units }).map((_, i) => (
        <g key={i} transform={`translate(${i * 24},0)`}>
          <MeanderUnit />
        </g>
      ))}
    </svg>
  )
}

/** 远山 + 云影（线稿），用于侧边栏底部等横向装饰。 */
export function Mountains({ className }: OrnamentProps) {
  return (
    <svg viewBox="0 0 200 44" fill="none" aria-hidden="true" className={cn('block', className)} preserveAspectRatio="xMidYMax meet">
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <path d="M0 40 L34 14 L58 34 L84 8 L116 36 L142 18 L172 40" />
        <path d="M20 40 C 40 34, 60 38, 80 35" />
        <path d="M118 40 C 138 35, 158 38, 186 34" />
      </g>
    </svg>
  )
}

/** 云纹分隔线：中央祥云 + 两侧渐隐金线。用于页面主标题之下。 */
export function CloudDivider({ className }: OrnamentProps) {
  return (
    <div className={cn('flex items-center gap-3.5 text-gold-400', className)} aria-hidden="true">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[rgba(192,154,82,0.38)]" />
      <Cloud className="h-[30px] w-[74px] shrink-0 opacity-85" />
      <span className="h-px flex-1 bg-gradient-to-r from-[rgba(192,154,82,0.38)] to-transparent" />
    </div>
  )
}

/** 小节标题前的迷你祥云。 */
export function MiniCloud({ className }: OrnamentProps) {
  return <Cloud className={cn('h-3.5 w-[26px] shrink-0 text-gold-500 opacity-70', className)} />
}

/**
 * 四角角隅组：一次性给卡片四角铺上角花。
 * 父级需 relative；颜色/透明度由 className 控制（默认鎏金 55%）。
 */
export function CornerSet({ className }: OrnamentProps) {
  const base = 'pointer-events-none absolute h-4 w-4 text-gold-500 opacity-55'
  return (
    <span aria-hidden="true">
      <Corner className={cn(base, 'left-[5px] top-[5px]', className)} />
      <Corner className={cn(base, 'right-[5px] top-[5px] rotate-90', className)} />
      <Corner className={cn(base, 'bottom-[5px] right-[5px] rotate-180', className)} />
      <Corner className={cn(base, 'bottom-[5px] left-[5px] -rotate-90', className)} />
    </span>
  )
}
