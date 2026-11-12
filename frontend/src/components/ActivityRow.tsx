import { Ban, CircleCheck, CircleX, FlaskConical, Hand, Settings2, Workflow } from 'lucide-react'
import { actionLabel, formatDateTime, formatRelative, STATUS_LABEL } from '@/lib/format'
import type { AuditRecord, AuditStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge, Tooltip } from './ui/primitives'

const STATUS_STYLE: Record<AuditStatus, { icon: typeof CircleCheck; className: string; tone: 'success' | 'danger' | 'warning' | 'primary' }> = {
  success: { icon: CircleCheck, className: 'text-success', tone: 'success' },
  failed: { icon: CircleX, className: 'text-danger', tone: 'danger' },
  skipped: { icon: Ban, className: 'text-warning', tone: 'warning' },
  dry_run: { icon: FlaskConical, className: 'text-primary', tone: 'primary' },
}

const SOURCE = {
  manual: { label: 'Вручную', icon: Hand },
  automation: { label: 'Автоматизация', icon: Workflow },
  system: { label: 'Система', icon: Settings2 },
}

export function ActivityRow({ record, compact = false }: { record: AuditRecord; compact?: boolean }) {
  const style = STATUS_STYLE[record.status]
  const source = SOURCE[record.source]
  const Icon = style.icon
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <Icon className={cn('mt-0.5 size-[18px] shrink-0', style.className)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13.5px] font-medium">{actionLabel(record.action)}</span>
          {record.chat_title && <span className="truncate text-[13px] text-muted-foreground">· {record.chat_title}</span>}
          {!compact && (
            <Badge tone={style.tone} className="ml-auto sm:ml-0">
              {STATUS_LABEL[record.status]}
            </Badge>
          )}
        </div>
        {record.detail && (
          <p className={cn('mt-0.5 text-[12.5px] leading-snug text-muted-foreground', compact && 'truncate')}>
            {record.rule_name && <span className="text-foreground/80">Правило «{record.rule_name}»: </span>}
            {record.detail}
          </p>
        )}
        {!compact && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-subtle-foreground">
            <span className="inline-flex items-center gap-1">
              <source.icon className="size-3" /> {source.label}
            </span>
            {record.duration_ms != null && <span className="tabular">{record.duration_ms} мс</span>}
            {record.error_code && <span className="font-mono">{record.error_code}</span>}
          </div>
        )}
      </div>
      <Tooltip content={formatDateTime(record.ts)}>
        <time dateTime={record.ts} className="shrink-0 text-[12px] whitespace-nowrap text-subtle-foreground tabular" tabIndex={0}>
          {formatRelative(record.ts)}
        </time>
      </Tooltip>
    </li>
  )
}
