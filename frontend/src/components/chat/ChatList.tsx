import { Pin } from 'lucide-react'
import { memo, type ReactNode } from 'react'
import { Avatar, ErrorState, ListSkeleton } from '@/components/common'
import { formatListTime, MEDIA_LABEL } from '@/lib/format'
import type { Dialog } from '@/lib/types'
import { cn } from '@/lib/utils'

interface ChatListProps {
  dialogs: Dialog[] | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  selectedId: number | null
  onSelect: (id: number) => void
  empty: ReactNode
  footer?: ReactNode
  label: string
}

function previewText(dialog: Dialog): string {
  const text = dialog.last_message_text ?? ''
  const media = text.match(/^\[(\w+)\]/)?.[1] as keyof typeof MEDIA_LABEL | undefined
  return media && MEDIA_LABEL[media] ? MEDIA_LABEL[media] : text
}

const Row = memo(function Row({
  dialog,
  selected,
  onSelect,
}: {
  dialog: Dialog
  selected: boolean
  onSelect: (id: number) => void
}) {
  const preview = previewText(dialog)
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(dialog.id)}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
          selected ? 'bg-primary-soft' : 'hover:bg-accent',
        )}
      >
        <Avatar id={dialog.id} name={dialog.title} kind={dialog.kind} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cn('truncate text-[14px] font-medium', selected && 'text-primary-soft-foreground')}>
              {dialog.title}
            </span>
            <span className="ml-auto shrink-0 text-[11.5px] text-subtle-foreground tabular">
              {formatListTime(dialog.last_message_date)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="truncate text-[13px] text-muted-foreground">
              {dialog.last_message_outgoing && preview && <span className="text-foreground/70">Вы: </span>}
              {preview || <span className="italic">Нет сообщений</span>}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {dialog.pinned && <Pin className="size-3 rotate-45 text-subtle-foreground" aria-label="Закреплён" />}
              {dialog.unread_count > 0 && (
                <span
                  className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] leading-5 font-semibold text-primary-foreground tabular"
                  aria-label={`Непрочитанных: ${dialog.unread_count}`}
                >
                  {dialog.unread_count > 999 ? '999+' : dialog.unread_count}
                </span>
              )}
            </span>
          </div>
        </div>
      </button>
    </li>
  )
})

export function ChatList({ dialogs, loading, error, onRetry, selectedId, onSelect, empty, footer, label }: ChatListProps) {
  if (loading) return <ListSkeleton rows={8} />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (!dialogs?.length) return <>{empty}</>
  return (
    <>
      <ul className="space-y-0.5 p-2" aria-label={label}>
        {dialogs.map((dialog) => (
          <Row key={dialog.id} dialog={dialog} selected={dialog.id === selectedId} onSelect={onSelect} />
        ))}
      </ul>
      {footer}
    </>
  )
}
