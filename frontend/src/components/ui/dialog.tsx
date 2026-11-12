import { X } from 'lucide-react'
import { AlertDialog as AlertPrimitive, Dialog as DialogPrimitive } from 'radix-ui'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

const overlay = 'fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] animate-fade dark:bg-black/50'
const panel =
  'fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-border bg-surface p-6 shadow-lg animate-pop outline-none'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}

export function Dialog({ open, onOpenChange, title, description, children, footer, className }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlay} />
        <DialogPrimitive.Content
          className={cn(panel, 'max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto scrollbar-thin', className)}
        >
          <div className="pr-8">
            <DialogPrimitive.Title className="text-[17px] font-semibold tracking-tight">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          {children}
          {footer && <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon-sm" className="absolute top-4 right-4" aria-label="Закрыть">
              <X />
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

interface ConfirmProps {
  title: ReactNode
  description: ReactNode
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => Promise<unknown> | void
  trigger: ReactNode
  children?: ReactNode
}

/** Confirmation for dangerous actions. Stays open (with a spinner) until onConfirm settles. */
export function ConfirmDialog({ title, description, confirmLabel, destructive, onConfirm, trigger, children }: ConfirmProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function confirm(event: MouseEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await onConfirm()
      setOpen(false)
    } catch {
      /* the caller reports the error; keep the dialog open for a retry */
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertPrimitive.Root open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <AlertPrimitive.Trigger asChild>{trigger}</AlertPrimitive.Trigger>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className={overlay} />
        <AlertPrimitive.Content className={cn(panel, 'max-w-md')}>
          <div>
            <AlertPrimitive.Title className="text-[17px] font-semibold tracking-tight">{title}</AlertPrimitive.Title>
            <AlertPrimitive.Description className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
              {description}
            </AlertPrimitive.Description>
          </div>
          {children}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertPrimitive.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                Отмена
              </Button>
            </AlertPrimitive.Cancel>
            <AlertPrimitive.Action asChild>
              <Button variant={destructive ? 'danger' : 'default'} loading={busy} onClick={confirm}>
                {confirmLabel}
              </Button>
            </AlertPrimitive.Action>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  )
}
