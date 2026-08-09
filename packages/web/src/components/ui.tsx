import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/utils'
import { X, Loader2 } from 'lucide-react'
import { CornerSet } from './ornaments'

// ============ Button 按钮组件 ============
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'gold'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

const buttonVariants = {
  default:
    'bg-[linear-gradient(120deg,#cfaf6e,#a8833f)] text-[#241b08] hover:bg-[linear-gradient(120deg,#ddc48e,#c09a52)] focus:ring-gold-500 shadow-[0_2px_12px_rgba(192,154,82,0.22),inset_0_1px_0_rgba(255,255,255,0.25)]',
  outline:
    'border border-[rgba(192,154,82,0.38)] text-gold-300 hover:border-gold-400 hover:bg-[rgba(192,154,82,0.06)]',
  ghost: 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200',
  destructive:
    'border border-[rgba(181,106,95,0.4)] text-bad hover:bg-[rgba(181,106,95,0.08)] focus:ring-bad',
  gold:
    'bg-[linear-gradient(120deg,#cfaf6e,#a8833f)] text-[#241b08] hover:bg-[linear-gradient(120deg,#ddc48e,#c09a52)] focus:ring-gold-500 shadow-[0_2px_12px_rgba(192,154,82,0.22),inset_0_1px_0_rgba(255,255,255,0.25)]',
}

const buttonSizes = {
  sm: 'px-2.5 py-1.5 text-xs rounded-md',
  md: 'px-4 py-2 text-sm rounded-lg',
  lg: 'px-6 py-3 text-base rounded-lg',
}

export function Button({
  variant = 'default',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900',
        'disabled:opacity-50 disabled:pointer-events-none',
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

// ============ Card 卡片组件 ============
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 重点卡片：鎏金发丝边 + 四角角隅纹 */
  featured?: boolean
}

export function Card({ className, children, featured = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'relative rounded-xl border border-gray-700 bg-gradient-to-b from-[#181512] to-[#141210] shadow-sm',
        featured && 'gold-trim',
        className
      )}
      {...props}
    >
      {featured && <CornerSet />}
      {children}
    </div>
  )
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col space-y-1.5 p-5', className)} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-base font-semibold text-gray-100 title-serif', className)} {...props}>
      {children}
    </h3>
  )
}

export function CardContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-5 pt-0', className)} {...props}>
      {children}
    </div>
  )
}

export function CardFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center p-5 pt-0', className)} {...props}>
      {children}
    </div>
  )
}

// ============ Input 输入框 ============
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export function Input({ label, className, id, ...props }: InputProps) {
  const autoId = useId()
  const inputId = id || autoId
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={inputId} className="block text-sm font-medium text-gray-300">{label}</label>}
      <input
        id={inputId}
        className={cn(
          'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100',
          'placeholder:text-gray-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500',
          'transition-colors',
          className
        )}
        {...props}
      />
    </div>
  )
}

// ============ Textarea 文本域 ============
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

export function Textarea({ label, className, id, ...props }: TextareaProps) {
  const autoId = useId()
  const textareaId = id || autoId
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={textareaId} className="block text-sm font-medium text-gray-300">{label}</label>}
      <textarea
        id={textareaId}
        className={cn(
          'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100',
          'placeholder:text-gray-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500',
          'transition-colors resize-y',
          className
        )}
        {...props}
      />
    </div>
  )
}

// ============ Select 选择框 ============
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: { value: string; label: string }[]
}

export function Select({ label, options, className, id, ...props }: SelectProps) {
  const autoId = useId()
  const selectId = id || autoId
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={selectId} className="block text-sm font-medium text-gray-300">{label}</label>}
      <select
        id={selectId}
        className={cn(
          'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100',
          'focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors',
          className
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// ============ Badge 徽章 ============
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'destructive' | 'gold' | 'seal'
}

const badgeVariants = {
  default: 'bg-gold-500/10 text-gold-300 border-[rgba(192,154,82,0.38)]',
  success: 'bg-ok/10 text-ok border-ok/30',
  warning: 'bg-warn/10 text-warn border-warn/30',
  destructive: 'bg-bad/10 text-bad border-bad/30',
  gold: 'bg-gold-500/10 text-gold-300 border-[rgba(192,154,82,0.38)]',
  seal: 'bg-seal-500/12 text-[#d98a7c] border-seal-500/35',
}

export function Badge({ variant = 'default', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-2.5 py-0.5 text-xs font-medium tracking-wide',
        badgeVariants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

// ============ Switch 开关 ============
interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <label className={cn('flex items-center gap-2.5', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900',
          checked ? 'bg-indigo-600' : 'bg-gray-700'
        )}
      >
        <span
          className={cn(
            'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          )}
        />
      </button>
      {label && <span className="text-sm font-medium text-gray-300">{label}</span>}
    </label>
  )
}

// ============ Dialog 弹窗 ============
interface DialogProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  // Escape 关闭 + 焦点管理
  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement
    // 聚焦弹窗容器
    requestAnimationFrame(() => dialogRef.current?.focus())

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
      // 简易焦点陷阱：Tab 循环在弹窗内
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      previousFocusRef.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  // Portal 到 body：避免被 main 的层叠上下文困住，导致弹窗被侧边栏（z-40）遮挡拦截点击
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩层 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      {/* 弹窗内容：限高 85vh，超长内容内部滚动（如功法详情），短弹窗不受影响 */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'relative z-10 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-xl animate-fade-in',
          'focus:outline-none',
          className
        )}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 id={titleId} className="text-lg font-semibold text-gray-100 title-serif">{title}</h2>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  )
}

// ============ Tabs 标签页 ============
interface TabsProps {
  tabs: { id: string; label: string }[]
  active: string
  onChange: (id: string) => void
  className?: string
}

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % tabs.length
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + tabs.length) % tabs.length
    if (next >= 0) {
      e.preventDefault()
      onChange(tabs[next].id)
      const btn = (e.currentTarget.parentElement?.children[next] as HTMLElement)
      btn?.focus()
    }
  }

  return (
    <div role="tablist" aria-label="标签页" className={cn('flex gap-1 rounded-lg bg-gray-800/50 p-1', className)}>
      {tabs.map((tab, idx) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => handleKeyDown(e, idx)}
          className={cn(
            'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            active === tab.id
              ? 'bg-gray-700 text-white shadow-sm'
              : 'text-gray-400 hover:text-gray-200'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ============ Spinner 加载指示器 ============
export function Spinner({ className, label = '加载中' }: { className?: string; label?: string }) {
  return <Loader2 role="status" aria-label={label} className={cn('h-5 w-5 animate-spin text-indigo-400', className)} />
}

// ============ Toast 通知系统 ============
interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

interface ToastContextValue {
  toast: (message: string, type?: 'success' | 'error' | 'info') => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

let toastId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastId
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }, [])

  const toastStyles = {
    success: 'border-emerald-500/50 bg-emerald-950/90 text-emerald-200',
    error: 'border-red-500/50 bg-red-950/90 text-red-200',
    info: 'border-indigo-500/50 bg-indigo-950/90 text-indigo-200',
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast容器 */}
      <div aria-live="polite" role="status" className="fixed bottom-4 right-4 z-[100] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'rounded-lg border px-4 py-3 text-sm shadow-lg animate-fade-in',
              toastStyles[t.type]
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// ============ EmptyState 空状态 ============
export function EmptyState({ message, icon }: { message: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-gray-500">
      {icon && <div className="mb-3">{icon}</div>}
      <p className="text-sm">{message}</p>
    </div>
  )
}
