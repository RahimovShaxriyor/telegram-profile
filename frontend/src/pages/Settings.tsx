import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Monitor, Moon, RotateCcw, Sun, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ErrorState, PageHeader } from '@/components/common'
import { Page } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Badge, Card, CardHeader, Skeleton, Switch, Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives'
import { api } from '@/lib/api'
import { formatBytes, formatNumber } from '@/lib/format'
import { notify } from '@/lib/notify'
import { setPref, usePrefs, type Prefs } from '@/lib/prefs'
import { keys, useStatus } from '@/lib/queries'
import { useTheme, type Theme } from '@/lib/theme'

function Row({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{title}</div>
        {description && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function PrefSwitch({ name, label }: { name: keyof Prefs; label: string }) {
  const prefs = usePrefs()
  return <Switch checked={prefs[name]} onCheckedChange={(value) => setPref(name, value)} aria-label={label} />
}

function PathValue({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-1">
      <code className="max-w-[min(420px,70vw)] truncate rounded-md bg-muted px-2 py-1 text-[12px]" title={value}>
        {value}
      </code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Скопировать путь"
        onClick={() => {
          navigator.clipboard
            ?.writeText(value)
            .then(() => notify.success('Путь скопирован'))
            .catch(() => notify.error(null, 'Не удалось скопировать'))
        }}
      >
        <Copy />
      </Button>
    </div>
  )
}

export default function Settings() {
  const { theme, setTheme } = useTheme()
  const status = useStatus()
  const queryClient = useQueryClient()
  const system = useQuery({ queryKey: keys.system, queryFn: api.system })
  const isDemo = status.data?.mode === 'demo'

  return (
    <Page className="max-w-4xl">
      <PageHeader title="Настройки" description="Оформление, уведомления, безопасность и локальные данные." />

      <Card>
        <CardHeader title="Оформление" />
        <div className="divide-y divide-border border-t border-border">
          <Row title="Тема" description="«Системная» следует настройкам Windows.">
            <Tabs value={theme} onValueChange={(value) => setTheme(value as Theme)}>
              <TabsList>
                <TabsTrigger value="light">
                  <Sun /> Светлая
                </TabsTrigger>
                <TabsTrigger value="dark">
                  <Moon /> Тёмная
                </TabsTrigger>
                <TabsTrigger value="system">
                  <Monitor /> Системная
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </Row>
        </div>
      </Card>

      <Card>
        <CardHeader title="Уведомления и ввод" description="Хранятся только в этом браузере." />
        <div className="divide-y divide-border border-t border-border">
          <Row title="Уведомления об успешных действиях" description="Например, «Пост опубликован». Ошибки показываются всегда.">
            <PrefSwitch name="successToasts" label="Уведомления об успешных действиях" />
          </Row>
          <Row title="Уведомлять о новых сообщениях" description="Короткое уведомление, когда приходят новые сообщения, пока вкладка открыта.">
            <PrefSwitch name="newMessageToasts" label="Уведомлять о новых сообщениях" />
          </Row>
          <Row title="Отправка по Enter" description="Если выключено — Enter переносит строку, а отправка по Ctrl+Enter.">
            <PrefSwitch name="enterToSend" label="Отправка по Enter" />
          </Row>
        </div>
      </Card>

      <Card>
        <CardHeader title="Безопасность" />
        {system.isPending ? (
          <div className="space-y-3 px-5 pb-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : system.isError ? (
          <ErrorState error={system.error} onRetry={() => system.refetch()} />
        ) : (
          <div className="divide-y divide-border border-t border-border">
            <Row
              title="Соединение"
              description={
                system.data.secure_connection
                  ? 'Сайт работает по HTTPS: данные между браузером и сервером зашифрованы.'
                  : 'Локальный режим: сайт открыт только на этом компьютере.'
              }
            >
              <Badge tone={system.data.secure_connection ? 'success' : 'neutral'}>
                {system.data.secure_connection ? 'HTTPS' : 'Только этот компьютер'}
              </Badge>
            </Row>
            <Row
              title="Сессия Telegram"
              description="Хранится на сервере в зашифрованном виде. Код и облачный пароль не сохраняются никогда."
            >
              <Badge tone="success">Зашифрована</Badge>
            </Row>
            <Row title="Вход на сайт" description="Браузерный сеанс действует 30 дней. Выйти везде можно в разделе «Аккаунт».">
              <Button asChild variant="outline" size="sm">
                <Link to="/account">Открыть «Аккаунт»</Link>
              </Button>
            </Row>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Ваши данные" description={isDemo ? 'Демо-данные этого браузера.' : 'Правила, журнал и архив вашей учётной записи.'} />
        {system.data && (
          <div className="divide-y divide-border border-t border-border">
            <Row title="Где хранятся" description={`${formatBytes(system.data.database_size_bytes)} · записей в журнале: ${formatNumber(system.data.audit_entries)}`}>
              {system.data.users_total !== null ? <PathValue value={system.data.data_location} /> : <span className="text-[12.5px] text-muted-foreground">{system.data.data_location}</span>}
            </Row>
            <Row title="Журнал действий" description="Удалить все записи журнала для текущего режима.">
              <ConfirmDialog
                title="Очистить журнал?"
                description="Все записи будут удалены. Сообщения в Telegram это не затрагивает."
                confirmLabel="Очистить"
                destructive
                onConfirm={async () => {
                  try {
                    await api.clearActivity()
                    await Promise.all([
                      queryClient.invalidateQueries({ queryKey: ['activity'] }),
                      queryClient.invalidateQueries({ queryKey: keys.system }),
                    ])
                    notify.success('Журнал очищен')
                  } catch (error) {
                    notify.error(error)
                    throw error
                  }
                }}
                trigger={
                  <Button variant="outline" size="sm">
                    <Trash2 /> Очистить журнал
                  </Button>
                }
              />
            </Row>
            {isDemo && (
              <Row title="Сбросить демо-данные" description="Вернуть вымышленные чаты в исходное состояние и удалить демо-правила и журнал.">
                <ConfirmDialog
                  title="Сбросить демо-данные?"
                  description="Демо-чаты, правила и журнал демо-режима вернутся в исходное состояние. Режим Telegram не затрагивается."
                  confirmLabel="Сбросить"
                  destructive
                  onConfirm={async () => {
                    try {
                      await api.demoReset()
                      await queryClient.resetQueries()
                      notify.success('Демо-данные сброшены')
                    } catch (error) {
                      notify.error(error)
                      throw error
                    }
                  }}
                  trigger={
                    <Button variant="outline" size="sm">
                      <RotateCcw /> Сбросить
                    </Button>
                  }
                />
              </Row>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="О приложении" />
        {system.data && (
          <dl className="grid gap-x-6 gap-y-3 border-t border-border px-5 py-4 text-[13px] sm:grid-cols-2">
            {[
              ['Версия TPAM', system.data.version],
              ['Python', system.data.python_version],
              ['Telethon', system.data.telethon_version],
              ['Система', system.data.platform],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium tabular">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </Page>
  )
}
