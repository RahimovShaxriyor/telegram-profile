import { Bot, CircleAlert, Megaphone, RefreshCw, Users, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { errorMessage } from '@/lib/api'
import { avatarTone, initials, type AvatarTone } from '@/lib/format'
import type { ChatKind } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Skeleton } from './ui/primitives'

const TONES: Record<AvatarTone, string> = {
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-400/20 dark:text-indigo-200',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-400/20 dark:text-sky-200',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-400/20 dark:text-teal-200',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-400/20 dark:text-orange-200',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-400/20 dark:text-rose-200',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-400/20 dark:text-violet-200',
}

const KIND_ICON: Partial<Record<ChatKind, LucideIcon>> = {
  bot: Bot,
  group: Users,
  supergroup: Users,
  channel: Megaphone,
}

export function Avatar({
  id,
  name,
  kind,
  size = 40,
  className,
}: {
  id: number
  name: string
  kind?: ChatKind
  size?: number
  className?: string
}) {
  const KindIcon = kind ? KIND_ICON[kind] : undefined
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }} aria-hidden>
      <span
        className={cn(
          'flex size-full items-center justify-center rounded-full font-semibold tracking-tight',
          TONES[avatarTone(id)],
        )}
        style={{ fontSize: Math.round(size * 0.36) }}
      >
        {initials(name)}
      </span>
      {KindIcon && size >= 36 && (
        <span className="absolute -right-0.5 -bottom-0.5 flex size-[18px] items-center justify-center rounded-full border-2 border-surface bg-muted text-muted-foreground">
          <KindIcon className="size-2.5" strokeWidth={2.5} />
        </span>
      )}
    </span>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13.5px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center animate-enter', className)}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  className,
  title = 'Не удалось загрузить данные',
}: {
  error: unknown
  onRetry?: () => void
  className?: string
  title?: string
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <CircleAlert className="size-5" />
      </div>
      <h3 className="text-[14.5px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw /> Повторить
        </Button>
      )}
    </div>
  )
}

export function ListSkeleton({ rows = 6, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="space-y-1 p-2" aria-busy aria-label="Загрузка">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
          {avatar && <Skeleton className="size-10 rounded-full" />}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5" style={{ width: `${45 + ((i * 17) % 35)}%` }} />
            <Skeleton className="h-3" style={{ width: `${60 + ((i * 11) % 30)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function StatusDot({ tone, pulse }: { tone: 'success' | 'warning' | 'danger' | 'neutral'; pulse?: boolean }) {
  const color = {
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    neutral: 'bg-subtle-foreground',
  }[tone]
  return (
    <span className="relative inline-flex size-2 shrink-0" aria-hidden>
      {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', color)} />}
      <span className={cn('relative inline-flex size-2 rounded-full', color)} />
    </span>
  )
}
