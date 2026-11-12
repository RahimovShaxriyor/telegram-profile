import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, LogIn, LogOut, MonitorSmartphone, RefreshCw, ShieldCheck, Trash2, Unplug, WifiOff } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Avatar, ErrorState, PageHeader, StatusDot } from '@/components/common'
import { Page, connectionLabel, connectionTone } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Badge, Card, CardHeader, Skeleton } from '@/components/ui/primitives'
import { api } from '@/lib/api'
import { notify } from '@/lib/notify'
import { keys, useStatus } from '@/lib/queries'
import type { Status } from '@/lib/types'

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-[13px] font-medium">{children}</dd>
    </div>
  )
}

/** After sign-out everything cached belongs to someone else: drop it and show the sign-in screen. */
function useSignedOut() {
  const queryClient = useQueryClient()
  return async () => {
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' })
    await queryClient.invalidateQueries({ queryKey: keys.session })
  }
}

function GuestAccount() {
  const signedOut = useSignedOut()
  const [busy, setBusy] = useState(false)
  return (
    <Card className="p-6">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-warning-soft text-warning-soft-foreground">
          <FlaskConical className="size-5" />
        </span>
        <div className="flex-1">
          <h2 className="text-[16px] font-semibold">Вы в демо-режиме</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Все чаты вымышленные. Чтобы работать со своим Telegram, войдите по номеру телефона — это займёт минуту.
          </p>
        </div>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true)
            await api.logout().catch(() => undefined)
            await signedOut()
          }}
        >
          {!busy && <LogIn />} Войти через Telegram
        </Button>
      </div>
    </Card>
  )
}

function UserAccount({ status }: { status: Status }) {
  const queryClient = useQueryClient()
  const signedOut = useSignedOut()
  const session = useQuery({ queryKey: keys.session, queryFn: api.session })
  const [deleteData, setDeleteData] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const { connection } = status
  const account = connection.account
  const user = session.data?.user
  const name = user?.name ?? (account ? `${account.first_name} ${account.last_name ?? ''}`.trim() : 'Аккаунт')

  async function reconnect() {
    setReconnecting(true)
    try {
      await api.reconnect()
      await queryClient.invalidateQueries()
      notify.success('Соединение обновлено')
    } catch (error) {
      notify.error(error)
    } finally {
      setReconnecting(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Профиль" description="Данные из Telegram" />
        <div className="px-5 pb-5">
          <div className="flex items-center gap-4">
            <Avatar id={user?.id ?? account?.id ?? 0} name={name} size={64} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[17px] font-semibold">{name}</span>
                {account?.is_premium && <Badge tone="primary">Premium</Badge>}
                {user?.is_owner && <Badge tone="warning">Администратор</Badge>}
              </div>
              <div className="text-[13px] text-muted-foreground">
                {(user?.username ?? account?.username) ? `@${user?.username ?? account?.username}` : 'Имя пользователя не задано'}
              </div>
            </div>
          </div>
          <dl className="mt-5 space-y-2.5 rounded-xl bg-surface-2 p-4">
            <Detail label="ID">{user?.id ?? account?.id ?? '—'}</Detail>
            <Detail label="Телефон">{user?.phone_masked ?? account?.phone_masked ?? '—'}</Detail>
          </dl>
        </div>
      </Card>

      <Card>
        <CardHeader title="Соединение с Telegram" />
        <div className="space-y-5 px-5 pb-5">
          {connection.state === 'unauthorized' || connection.state === 'disconnected' ? (
            <div className="flex items-start gap-3 rounded-xl bg-danger-soft p-4 text-[13px] text-danger-soft-foreground">
              <WifiOff className="mt-0.5 size-4 shrink-0" />
              <span>
                {connection.error ?? 'Нет соединения.'}
                {connection.state === 'unauthorized' && ' Нажмите «Выйти» и войдите снова по номеру телефона.'}
              </span>
            </div>
          ) : null}
          <dl className="space-y-2.5 rounded-xl bg-surface-2 p-4">
            <Detail label="Статус">
              <span className="inline-flex items-center gap-1.5">
                <StatusDot tone={connectionTone(connection.state)} />
                {connectionLabel(connection.state)}
              </span>
            </Detail>
            <Detail label="Дата-центр Telegram">{connection.dc_id ? `DC ${connection.dc_id}` : '—'}</Detail>
            <Detail label="Устройство в Telegram">{connection.device_model ?? '—'}</Detail>
          </dl>
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            Сессия хранится на сервере в зашифрованном виде. В Telegram она видна в Настройки → Устройства как «{connection.device_model}» — там её тоже можно завершить.
          </p>
          <Button variant="outline" onClick={reconnect} loading={reconnecting}>
            {!reconnecting && <RefreshCw />} Переподключить
          </Button>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Выход и данные" />
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          <Button
            variant="outline"
            onClick={async () => {
              await api.logout().catch(() => undefined)
              await signedOut()
            }}
          >
            <LogOut /> Выйти на этом устройстве
          </Button>
          <ConfirmDialog
            title="Выйти на всех устройствах?"
            description="Все браузеры, где вы входили в TPAM, потребуют войти заново. Автоответы и архив продолжат работать."
            confirmLabel="Выйти везде"
            onConfirm={async () => {
              try {
                await api.logoutEverywhere()
                await signedOut()
              } catch (error) {
                notify.error(error)
                throw error
              }
            }}
            trigger={
              <Button variant="outline">
                <MonitorSmartphone /> Выйти на всех устройствах
              </Button>
            }
          />
          <ConfirmDialog
            title="Отключить Telegram от TPAM?"
            description="Сессия TPAM будет завершена в Telegram, автоответы и архив остановятся. Для повторного входа понадобится код."
            confirmLabel="Отключить"
            destructive
            onConfirm={async () => {
              try {
                await api.disconnectAccount(deleteData)
                await signedOut()
              } catch (error) {
                notify.error(error)
                throw error
              }
            }}
            trigger={
              <Button variant="danger-ghost">
                <Unplug /> Отключить Telegram
              </Button>
            }
          >
            <label className="flex items-center gap-2.5 text-[13px]">
              <input type="checkbox" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} className="size-4 accent-[var(--primary)]" />
              <Trash2 className="size-3.5 text-danger" /> Также удалить все мои данные с сервера (правила, журнал, архив)
            </label>
          </ConfirmDialog>
        </div>
      </Card>
    </div>
  )
}

export default function Account() {
  const status = useStatus()
  return (
    <Page>
      <PageHeader title="Аккаунт" description="Ваш профиль Telegram, соединение и выход." />
      {status.isError ? (
        <ErrorState error={status.error} onRetry={() => status.refetch()} />
      ) : !status.data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : status.data.mode === 'demo' ? (
        <GuestAccount />
      ) : (
        <UserAccount status={status.data} />
      )}
    </Page>
  )
}
