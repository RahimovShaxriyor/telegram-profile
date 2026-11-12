import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form'
import { cn } from '@/lib/utils'

/** Selected chat lives in the URL (?chat=ID) so links from other pages open it directly. */
export function useSelectedChat(): [number | null, (id: number | null) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get('chat')
  const id = raw && /^-?\d+$/.test(raw) ? Number(raw) : null
  const select = (next: number | null) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next === null) updated.delete('chat')
        else updated.set('chat', String(next))
        updated.delete('msg')
        return updated
      },
      { replace: false },
    )
  return [id, select]
}

interface ChatWorkspaceProps {
  hasSelection: boolean
  sidebar: ReactNode
  children: ReactNode
}

export function ChatWorkspace({ hasSelection, sidebar, children }: ChatWorkspaceProps) {
  return (
    <div className="flex h-full min-h-0">
      <div
        className={cn(
          'flex w-full min-w-0 flex-col border-r border-border bg-surface md:w-[320px] md:shrink-0 xl:w-[360px]',
          hasSelection && 'hidden md:flex',
        )}
      >
        {sidebar}
      </div>
      <div className={cn('min-w-0 flex-1 flex-col', hasSelection ? 'flex' : 'hidden md:flex')}>{children}</div>
    </div>
  )
}

export function SidebarHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="space-y-3 border-b border-border px-4 pt-4 pb-3">
      <h1 className="text-[18px] font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="bg-surface-2 pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onChange('')
        }}
      />
      {value && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-1/2 right-0.5 size-7 -translate-y-1/2"
          onClick={() => onChange('')}
          aria-label="Очистить поиск"
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

export function NoChatSelected({ icon: Icon, title, description }: { icon: typeof Search; title: string; description: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-chat-backdrop p-8 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface text-muted-foreground shadow-sm">
        <Icon className="size-6" />
      </div>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">{description}</p>
    </div>
  )
}
