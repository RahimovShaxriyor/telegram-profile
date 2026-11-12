import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, ShieldUser, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { Avatar, EmptyState, ErrorState, PageHeader, StatusDot } from '@/components/common'
import { Page } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Badge, Card, CardHeader, Skeleton, Switch } from '@/components/ui/primitives'
import { api } from '@/lib/api'
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import { notify } from '@/lib/notify'

export default function Admin() {
  const queryClient = useQueryClient()
  const admin = useQuery({ queryKey: ['admin'], queryFn: api.admin, refetchInterval: 30_000 })
  const [toggling, setToggling] = useState(false)

  if (admin.isError) {
    return (
      <Page>
        <ErrorState error={admin.error} onRetry={() => admin.refetch()} />
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader title="Пользователи" description="Кто пользуется сервисом. Видно только администратору." />
      {!admin.data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <>
          <Card>
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <ShieldUser className="size-5" />
              </span>
              <div className="flex-1">
                <h2 className="text-[15px] font-semibold">Регистрация новых пользователей</h2>
                <p className="text-[13px] text-muted-foreground">
                  {admin.data.registration_open
                    ? 'Открыта: войти может любой человек с аккаунтом Telegram.'
                    : 'Закрыта: войти могут только уже зарегистрированные пользователи.'}{' '}
                  Лимит: {formatNumber(admin.data.max_users)}. Демо-гостей сейчас: {admin.data.guests_active}.
                </p>
              </div>
              <Switch
                checked={admin.data.registration_open}
                disabled={toggling}
                aria-label="Регистрация открыта"
                onCheckedChange={async (open) => {
                  setToggling(true)
                  try {
                    queryClient.setQueryData(['admin'], await api.setRegistration(open))
                    notify.success(open ? 'Регистрация открыта' : 'Регистрация закрыта')
                  } catch (error) {
                    notify.error(error)
                  } finally {
                    setToggling(false)
                  }
                }}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title={`Пользователи · ${admin.data.users.length}`} />
            {admin.data.users.length === 0 ? (
              <EmptyState icon={Users} title="Пока никого" />
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {admin.data.users.map((user) => (
                  <li key={user.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar id={user.id} name={user.name} size={38} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                          {user.name}
                          {user.is_owner && (
                            <Badge tone="warning">
                              <Crown /> Администратор
                            </Badge>
                          )}
                        </div>
                        <div className="text-[12.5px] text-muted-foreground">
                          {user.username ? `@${user.username} · ` : ''}
                          {user.phone_masked ?? ''} · с {formatDateTime(user.created_at)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[12.5px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot tone={user.online ? 'success' : 'neutral'} />
                        {user.online ? 'Подключён' : 'Не подключён'}
                      </span>
                      <span>вход {formatRelative(user.last_login_at)}</span>
                      {!user.is_owner && (
                        <ConfirmDialog
                          title={`Удалить ${user.name}?`}
                          description="Сессия TPAM будет завершена в Telegram, а все данные пользователя (правила, журнал, архив) удалены с сервера. Пользователь сможет зарегистрироваться снова, если регистрация открыта."
                          confirmLabel="Удалить"
                          destructive
                          onConfirm={async () => {
                            try {
                              await api.removeUser(user.id)
                              await queryClient.invalidateQueries({ queryKey: ['admin'] })
                              notify.success('Пользователь удалён')
                            } catch (error) {
                              notify.error(error)
                              throw error
                            }
                          }}
                          trigger={
                            <Button variant="ghost" size="icon-sm" aria-label={`Удалить ${user.name}`}>
                              <Trash2 />
                            </Button>
                          }
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </Page>
  )
}
