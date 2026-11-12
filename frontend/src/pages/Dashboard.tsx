import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ArrowRight,
  Inbox,
  Megaphone,
  MessageCircle,
  MessageSquarePlus,
  PlugZap,
  Send,
  ShieldCheck,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Avatar, EmptyState, ErrorState, PageHeader, StatusDot } from '@/components/common'
import { Page, connectionLabel, connectionTone } from '@/components/layout/AppShell'
import { ActivityRow } from '@/components/ActivityRow'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader, Skeleton } from '@/components/ui/primitives'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { keys, useStatus } from '@/lib/queries'
import type { Overview, Status } from '@/lib/types'

function greeting(date = new Date()): string {
  const hour = date.getHours()
  if (hour < 5) return 'Доброй ночи'
  if (hour < 12) return 'Доброе утро'
  if (hour < 18) return 'Добрый день'
  return 'Добрый вечер'
}

function StatTile({ icon: Icon, label, value, to }: { icon: LucideIcon; label: string; value: ReactNode; to: string }) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3.5 rounded-xl border border-border bg-surface p-4 shadow-sm transition-[box-shadow,transform] outline-none hover:-translate-y-px hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0">
        <div className="text-[12.5px] text-muted-foreground">{label}</div>
        <div className="text-[20px] leading-tight font-semibold tracking-tight tabular">{value}</div>
      </div>
      <ArrowRight className="ml-auto size-4 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  )
}

function ConnectionCard({ status }: { status: Status }) {
  const { connection, mode } = status
  const account = connection.account
  const name = account ? `${account.first_name} ${account.last_name ?? ''}`.trim() : null
  return (
    <Card>
      <CardHeader
        title="Подключение"
        action={
          <Button asChild variant="ghost" size="sm">
            <Link to="/account">Управление</Link>
          </Button>
        }
      />
      <div className="px-5 pb-5">
        {account && name ? (
          <div className="flex items-center gap-3.5">
            <Avatar id={account.id} name={name} size={48} />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">{name}</div>
              <div className="text-[13px] text-muted-foreground">
                {account.username ? `@${account.username}` : 'без имени пользователя'}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={PlugZap}
            title="Telegram не подключён"
            description="Подключите аккаунт, чтобы работать с настоящими чатами."
            action={
              <Button asChild size="sm">
                <Link to="/account">Подключить</Link>
              </Button>
            }
            className="py-4"
          />
        )}
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-3 text-[12.5px]">
          <div>
            <dt className="text-muted-foreground">Статус</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
              <StatusDot tone={connectionTone(connection.state)} />
              {connectionLabel(connection.state)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Режим</dt>
            <dd className="mt-0.5 font-medium">{mode === 'demo' ? 'Демо-данные' : 'Telegram'}</dd>
          </div>
        </dl>
      </div>
    </Card>
  )
}

function AutomationCard({ overview }: { overview: Overview }) {
  const { automation, rules_enabled, rules_total } = overview
  return (
    <Card>
      <CardHeader
        title="Автоматизация"
        action={
          <Badge tone={automation.enabled ? 'success' : 'neutral'}>
            <StatusDot tone={automation.enabled ? 'success' : 'neutral'} />
            {automation.enabled ? 'Включена' : 'Выключена'}
          </Badge>
        }
      />
      <div className="space-y-4 px-5 pb-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-surface-2 p-3">
            <div className="text-[12px] text-muted-foreground">Активных правил</div>
            <div className="mt-0.5 text-[18px] font-semibold tabular">
              {rules_enabled}
              <span className="text-[13px] font-normal text-muted-foreground"> из {rules_total}</span>
            </div>
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <div className="text-[12px] text-muted-foreground">Автоответов за сутки</div>
            <div className="mt-0.5 text-[18px] font-semibold tabular">
              {automation.sent_last_day}
              <span className="text-[13px] font-normal text-muted-foreground"> / {automation.limits.global_per_day}</span>
            </div>
          </div>
        </div>
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
          Лимиты, паузы между ответами и запрет ответов ботам работают всегда.
        </p>
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link to="/automation">Открыть правила</Link>
        </Button>
      </div>
    </Card>
  )
}

const QUICK_ACTIONS: { to: string; label: string; hint: string; icon: LucideIcon }[] = [
  { to: '/messages', label: 'Написать сообщение', hint: 'Откройте диалог и отправьте текст или файл', icon: Send },
  { to: '/channels', label: 'Опубликовать в канале', hint: 'Сразу или по расписанию', icon: Megaphone },
  { to: '/automation?new=1', label: 'Создать правило', hint: 'Автоответ шаблоном или от ИИ', icon: MessageSquarePlus },
  { to: '/activity', label: 'Посмотреть журнал', hint: 'Все действия приложения', icon: Activity },
]

export function Dashboard() {
  const status = useStatus()
  const connected = status.data?.connection.state === 'connected'
  const overview = useQuery({ queryKey: keys.overview, queryFn: api.overview, enabled: connected })
  const account = status.data?.connection.account

  return (
    <Page>
      <PageHeader
        title={account ? `${greeting()}, ${account.first_name}` : greeting()}
        description="Сводка по вашему Telegram-аккаунту и последние действия приложения."
      />

      {status.isError && <ErrorState error={status.error} onRetry={() => status.refetch()} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {overview.data ? (
          <>
            <StatTile icon={MessageCircle} label="Диалоги" value={formatNumber(overview.data.dialogs_total)} to="/messages" />
            <StatTile
              icon={Users}
              label="Группы"
              value={formatNumber(overview.data.kinds.group + overview.data.kinds.supergroup)}
              to="/groups"
            />
            <StatTile icon={Megaphone} label="Каналы" value={formatNumber(overview.data.kinds.channel)} to="/channels" />
            <StatTile icon={Inbox} label="Непрочитанные чаты" value={formatNumber(overview.data.unread_chats)} to="/messages?filter=unread" />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[74px] rounded-xl" />)
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Быстрые действия" />
            <div className="grid gap-1 px-2 pb-2 sm:grid-cols-2">
              {QUICK_ACTIONS.map(({ to, label, hint, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className="flex items-center gap-3 rounded-lg p-3 transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium">{label}</div>
                    <div className="truncate text-[12.5px] text-muted-foreground">{hint}</div>
                  </div>
                </Link>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Последние события"
              description="Что приложение делало от вашего имени"
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link to="/activity">Весь журнал</Link>
                </Button>
              }
            />
            <div className="px-2 pb-2">
              {overview.isPending && connected ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} className="h-10" />
                  ))}
                </div>
              ) : overview.data?.recent_activity.length ? (
                <ul className="divide-y divide-border">
                  {overview.data.recent_activity.map((record) => (
                    <ActivityRow key={record.id} record={record} compact />
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={Activity}
                  title="Пока ничего не произошло"
                  description="Отправленные сообщения, публикации и автоответы появятся здесь."
                  className="py-8"
                />
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {status.data ? <ConnectionCard status={status.data} /> : <Skeleton className="h-56 rounded-xl" />}
          {overview.data ? (
            <AutomationCard overview={overview.data} />
          ) : connected ? (
            <Skeleton className="h-60 rounded-xl" />
          ) : (
            <Card className="p-5">
              <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
                <Workflow className="size-4" /> Автоматизация станет доступна после подключения.
              </div>
            </Card>
          )}
        </div>
      </div>
    </Page>
  )
}
