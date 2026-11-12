import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, KeyRound, LoaderCircle, Lock, MessageSquareLock, Send, ShieldAlert, Smartphone } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/form'
import { api, ApiError, UNAUTHORIZED_EVENT } from '@/lib/api'
import { keys } from '@/lib/queries'
import type { LoginStep, SessionInfo } from '@/lib/types'

/** Shows the sign-in screen until the browser has a session (Telegram user or demo guest). */
export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const session = useQuery({ queryKey: keys.session, queryFn: api.session, staleTime: 60_000 })

  useEffect(() => {
    const onUnauthorized = () => void queryClient.invalidateQueries({ queryKey: keys.session })
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [queryClient])

  if (session.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground" aria-busy>
        <LoaderCircle className="size-6 animate-spin" />
      </div>
    )
  }
  if (session.isError) {
    return (
      <Centered>
        <p className="text-[14px] text-muted-foreground">Сервер TPAM недоступен. Обновите страницу чуть позже.</p>
        <Button className="mt-4" variant="outline" onClick={() => session.refetch()}>
          Повторить
        </Button>
      </Centered>
    )
  }
  if (session.data.signed_in) return <>{children}</>
  return <LoginScreen info={session.data} />
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-border bg-surface p-7 shadow-md animate-pop">{children}</div>
    </div>
  )
}

function Brand() {
  return (
    <div className="mb-6 flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-9" />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">TPAM</div>
        <div className="text-[12px] text-muted-foreground">Менеджер аккаунта Telegram</div>
      </div>
    </div>
  )
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-soft-foreground" role="alert">
      {message}
    </p>
  )
}

function useStep() {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(action: () => Promise<unknown>, onDone?: (result: unknown) => void) {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      onDone?.(result)
      if ((result as LoginStep | undefined)?.step === 'done' || result === undefined) {
        queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' })
        await queryClient.invalidateQueries({ queryKey: keys.session })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Что-то пошло не так. Попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, setError }
}

const TERMS = (
  <div className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">
    <p>TPAM подключается к вашему аккаунту Telegram как ещё одно устройство (как Telegram Desktop) и действует от вашего имени только по вашим командам и правилам.</p>
    <p>На сервере хранятся: зашифрованная сессия Telegram, ваши правила, журнал действий и — только если вы включите — архив сообщений. Номер телефона в открытом виде не хранится.</p>
    <p>Код подтверждения и облачный пароль передаются сразу в Telegram и нигде не сохраняются.</p>
    <p>Выйти и удалить все свои данные можно в любой момент в разделе «Аккаунт». Сеанс также можно завершить в Telegram → Настройки → Устройства.</p>
    <p>Запрещено использовать сервис для спама и массовых рассылок — это нарушает правила Telegram и ведёт к блокировке аккаунта.</p>
  </div>
)

function PhoneStep({ info, onStep }: { info: SessionInfo; onStep: (step: LoginStep) => void }) {
  const [phone, setPhone] = useState('+')
  const [accepted, setAccepted] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const { busy, error, run } = useStep()
  const guest = useStep()
  const valid = /^\+?[1-9]\d{7,14}$/.test(phone.replace(/[\s\-()]/g, ''))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (valid && accepted) void run(() => api.loginPhone(phone, true), (r) => onStep(r as LoginStep))
  }

  return (
    <>
      <h1 className="text-[20px] font-semibold tracking-tight">Вход через Telegram</h1>
      <p className="mt-1 mb-5 text-[13.5px] text-muted-foreground">Введите номер — код подтверждения придёт в приложение Telegram.</p>
      {!info.registration_open && (
        <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-[12.5px] text-warning-soft-foreground">
          Регистрация новых пользователей закрыта. Войти могут только те, у кого уже есть аккаунт.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Номер телефона" hint="В международном формате, например +998 90 123 45 67">
          {(props) => (
            <Input {...props} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus className="h-10 text-[15px]" />
          )}
        </Field>
        <label className="flex items-start gap-2.5 text-[13px] leading-snug">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
          <span>
            Я согласен с{' '}
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => setTermsOpen(true)}>
              условиями использования
            </button>{' '}
            и тем, что TPAM будет работать с моим аккаунтом Telegram.
          </span>
        </label>
        <ErrorNote message={error} />
        <Button type="submit" className="h-10 w-full" loading={busy} disabled={!valid || !accepted}>
          {!busy && <Send />} Получить код
        </Button>
      </form>
      <div className="my-5 flex items-center gap-3 text-[12px] text-subtle-foreground">
        <span className="h-px flex-1 bg-border" /> или <span className="h-px flex-1 bg-border" />
      </div>
      <Button variant="outline" className="w-full" loading={guest.busy} onClick={() => guest.run(api.startGuest)}>
        {!guest.busy && <FlaskConical />} Посмотреть демо без входа
      </Button>
      <ErrorNote message={guest.error} />
      <Dialog open={termsOpen} onOpenChange={setTermsOpen} title="Условия использования" footer={<Button onClick={() => setTermsOpen(false)}>Понятно</Button>}>
        {TERMS}
      </Dialog>
    </>
  )
}

function CodeStep({ step, onStep, onRestart }: { step: LoginStep; onStep: (s: LoginStep) => void; onRestart: () => void }) {
  const [code, setCode] = useState('')
  const { busy, error, run } = useStep()
  const digits = code.replace(/\D/g, '')
  return (
    <>
      <div className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <MessageSquareLock className="size-5" />
      </div>
      <h1 className="text-[20px] font-semibold tracking-tight">Код подтверждения</h1>
      <p className="mt-1 mb-4 text-[13.5px] text-muted-foreground">
        Отправлен в Telegram на {step.phone_masked ?? 'ваш номер'} — от официального аккаунта «Telegram».
      </p>
      <p className="mb-4 flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-[12.5px] leading-relaxed text-warning-soft-foreground">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" /> Никому не сообщайте и не пересылайте этот код. Вводите его только здесь.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (digits.length >= 5) void run(() => api.loginCode(digits), (r) => onStep(r as LoginStep))
        }}
        className="space-y-4"
        noValidate
      >
        <Field label="Код из Telegram">
          {(props) => (
            <Input {...props} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="12345" maxLength={8} autoFocus className="h-11 text-center font-mono text-[20px] tracking-[0.35em]" />
          )}
        </Field>
        <ErrorNote message={error} />
        <Button type="submit" className="h-10 w-full" loading={busy} disabled={digits.length < 5}>
          Войти
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onRestart} disabled={busy}>
          Изменить номер
        </Button>
      </form>
    </>
  )
}

function PasswordStep({ step, onRestart }: { step: LoginStep; onRestart: () => void }) {
  const [password, setPassword] = useState('')
  const { busy, error, run } = useStep()
  return (
    <>
      <div className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <Lock className="size-5" />
      </div>
      <h1 className="text-[20px] font-semibold tracking-tight">Облачный пароль</h1>
      <p className="mt-1 mb-4 text-[13.5px] text-muted-foreground">
        На аккаунте включена двухэтапная аутентификация. Пароль передаётся в Telegram и не сохраняется.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (password) void run(() => api.loginPassword(password))
        }}
        className="space-y-4"
        noValidate
      >
        <Field label="Пароль" hint={step.password_hint ? `Подсказка: ${step.password_hint}` : undefined}>
          {(props) => <Input {...props} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus className="h-10" />}
        </Field>
        <ErrorNote message={error} />
        <Button type="submit" className="h-10 w-full" loading={busy} disabled={!password}>
          Подтвердить
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onRestart} disabled={busy}>
          Начать заново
        </Button>
      </form>
    </>
  )
}

function SetupStep() {
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const { busy, error, run } = useStep()
  const valid = /^\d{3,10}$/.test(apiId) && /^[0-9a-fA-F]{32}$/.test(apiHash.trim())
  return (
    <>
      <div className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <KeyRound className="size-5" />
      </div>
      <h1 className="text-[20px] font-semibold tracking-tight">Настройка сервера</h1>
      <p className="mt-1 mb-4 text-[13.5px] leading-relaxed text-muted-foreground">
        Один раз укажите ключи приложения с{' '}
        <a href="https://my.telegram.org" target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
          my.telegram.org
        </a>{' '}
        → API development tools. Пользователи их не увидят — они входят только по номеру и коду.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void run(() => api.setup(Number(apiId), apiHash.trim()))
        }}
        className="space-y-4"
        noValidate
      >
        <Field label="API ID">{(props) => <Input {...props} inputMode="numeric" value={apiId} onChange={(e) => setApiId(e.target.value)} autoComplete="off" />}</Field>
        <Field label="API HASH">
          {(props) => <Input {...props} type="password" value={apiHash} onChange={(e) => setApiHash(e.target.value)} autoComplete="off" className="font-mono" />}
        </Field>
        <ErrorNote message={error} />
        <Button type="submit" className="w-full" loading={busy} disabled={!valid}>
          Сохранить
        </Button>
      </form>
    </>
  )
}

function LoginScreen({ info }: { info: SessionInfo }) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<LoginStep | null>(info.login)

  async function restart() {
    await api.loginCancel().catch(() => undefined)
    setStep(null)
    void queryClient.invalidateQueries({ queryKey: keys.session })
  }

  return (
    <Centered>
      <Brand />
      {!info.server_configured ? (
        info.setup_allowed ? (
          <SetupStep />
        ) : (
          <>
            <h1 className="text-[18px] font-semibold">Сервис ещё не настроен</h1>
            <p className="mt-2 text-[13.5px] text-muted-foreground">Администратор должен указать ключи приложения Telegram. Загляните позже.</p>
          </>
        )
      ) : step?.step === 'code' ? (
        <CodeStep step={step} onStep={setStep} onRestart={restart} />
      ) : step?.step === 'password' ? (
        <PasswordStep step={step} onRestart={restart} />
      ) : (
        <PhoneStep info={info} onStep={setStep} />
      )}
      <p className="mt-6 flex items-center justify-center gap-1.5 text-[11.5px] text-subtle-foreground">
        <Smartphone className="size-3" /> Вход как в Telegram — без паролей и ключей API
      </p>
    </Centered>
  )
}
