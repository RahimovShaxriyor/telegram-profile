import {
  Activity,
  Archive as ArchiveIcon,
  FlaskConical,
  LayoutDashboard,
  Megaphone,
  Menu,
  MessageCircle,
  Moon,
  Settings,
  ShieldUser,
  Sun,
  UserRound,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { useLiveUpdates, useStatus } from '@/lib/queries'
import { useTheme } from '@/lib/theme'
import type { Status } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Avatar, StatusDot } from '../common'
import { Button } from '../ui/button'
import { Tooltip } from '../ui/primitives'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Обзор', icon: LayoutDashboard },
  { to: '/messages', label: 'Сообщения', icon: MessageCircle },
  { to: '/groups', label: 'Группы', icon: Users },
  { to: '/channels', label: 'Каналы', icon: Megaphone },
  { to: '/archive', label: 'Архив', icon: ArchiveIcon },
  { to: '/automation', label: 'Автоматизация', icon: Workflow },
  { to: '/activity', label: 'Журнал', icon: Activity },
  { to: '/account', label: 'Аккаунт', icon: UserRound },
  { to: '/settings', label: 'Настройки', icon: Settings },
]

const ADMIN_NAV: NavItem = { to: '/admin', label: 'Пользователи', icon: ShieldUser }

const STATE_LABEL: Record<Status['connection']['state'], string> = {
  connected: 'Подключено',
  connecting: 'Подключение…',
  disconnected: 'Нет соединения',
  not_configured: 'Не подключён',
  unauthorized: 'Требуется вход',
}

export function connectionTone(state: Status['connection']['state']) {
  if (state === 'connected') return 'success' as const
  if (state === 'connecting') return 'warning' as const
  if (state === 'disconnected') return 'danger' as const
  return 'neutral' as const
}

export function connectionLabel(state: Status['connection']['state']) {
  return STATE_LABEL[state]
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-lg px-2 py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
      <img src="/favicon.svg" alt="" className="size-7" />
      <div className="leading-tight">
        <div className="text-[14px] font-semibold tracking-tight">TPAM</div>
        <div className="text-[11px] text-muted-foreground">Telegram Account Manager</div>
      </div>
    </Link>
  )
}

function NavLinks({ onNavigate, isOwner }: { onNavigate?: () => void; isOwner: boolean }) {
  const items = isOwner ? [...NAV, ADMIN_NAV] : NAV
  return (
    <nav aria-label="Основная навигация" className="grid gap-0.5">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'group flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
              isActive
                ? 'bg-surface text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={cn('size-[17px]', isActive ? 'text-primary' : 'opacity-80')} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function AccountChip({ status }: { status: Status | undefined }) {
  if (!status) return <div className="h-12" />
  const { connection, mode } = status
  const account = connection.account
  const name = account ? `${account.first_name} ${account.last_name ?? ''}`.trim() : 'Аккаунт не подключён'
  return (
    <Link
      to="/account"
      className="flex items-center gap-2.5 rounded-xl p-2 transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      {account ? (
        <Avatar id={account.id} name={name} size={34} />
      ) : (
        <span className="flex size-[34px] items-center justify-center rounded-full bg-muted text-muted-foreground">
          <UserRound className="size-4" />
        </span>
      )}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[13px] font-medium">{name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <StatusDot tone={connectionTone(connection.state)} pulse={connection.state === 'connecting'} />
          {mode === 'demo' ? 'Демо-режим' : connectionLabel(connection.state)}
        </div>
      </div>
    </Link>
  )
}

function ThemeToggle() {
  const { resolved, setTheme } = useTheme()
  const next = resolved === 'dark' ? 'light' : 'dark'
  return (
    <Tooltip content={resolved === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
      <Button variant="ghost" size="icon-sm" onClick={() => setTheme(next)} aria-label="Переключить тему">
        {resolved === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </Tooltip>
  )
}

function SidebarContent({ status, onNavigate }: { status: Status | undefined; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-5 px-3 py-4">
      <div className="flex items-center justify-between">
        <Brand />
        <ThemeToggle />
      </div>
      <NavLinks onNavigate={onNavigate} isOwner={status?.is_owner ?? false} />
      <div className="mt-auto space-y-2">
        {status?.mode === 'demo' && (
          <div className="rounded-xl border border-warning/30 bg-warning-soft p-3 text-[12px] leading-snug text-warning-soft-foreground">
            <div className="mb-0.5 flex items-center gap-1.5 font-semibold">
              <FlaskConical className="size-3.5" /> Демо-режим
            </div>
            Показаны вымышленные данные. Реальный Telegram не используется.
          </div>
        )}
        <AccountChip status={status} />
      </div>
    </div>
  )
}

function DemoBanner() {
  return (
    <div className="flex items-center justify-center gap-2 border-b border-warning/25 bg-warning-soft px-4 py-1.5 text-center text-[12.5px] text-warning-soft-foreground">
      <FlaskConical className="size-3.5 shrink-0" />
      <span>
        Демо-режим: все чаты и сообщения вымышленные.{' '}
        <Link to="/account" className="font-medium underline underline-offset-2 hover:no-underline">
          Войти через Telegram
        </Link>
      </span>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: status } = useStatus()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  useLiveUpdates(status?.connection.state === 'connected')
  const current = NAV.find((item) => (item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)))

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Перейти к содержимому
      </a>
      <aside className="hidden w-[248px] shrink-0 border-r border-border bg-sidebar lg:block">
        <SidebarContent status={status} />
      </aside>

      <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/30 animate-fade lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-[272px] border-r border-border bg-sidebar shadow-lg animate-enter outline-none lg:hidden">
            <DialogPrimitive.Title className="sr-only">Меню</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Разделы приложения</DialogPrimitive.Description>
            <SidebarContent status={status} onNavigate={() => setMenuOpen(false)} />
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" className="absolute top-4 -right-11 bg-surface" aria-label="Закрыть меню">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface/80 px-3 backdrop-blur lg:hidden">
          <Button variant="ghost" size="icon-sm" onClick={() => setMenuOpen(true)} aria-label="Открыть меню">
            <Menu />
          </Button>
          <span className="text-[14px] font-semibold">{current?.label ?? 'TPAM'}</span>
        </header>
        {status?.mode === 'demo' && <DemoBanner />}
        <main id="main" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {children}
        </main>
      </div>
    </div>
  )
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 animate-enter', className)}>{children}</div>
}
