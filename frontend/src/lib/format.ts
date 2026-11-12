import type { AuditStatus, ChatKind, MediaKind } from './types'

const locale = 'ru-RU'

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function daysBetween(now: Date, date: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
}

/** Compact timestamp for lists: 14:05 · вчера · пн · 03.11.25 */
export function formatListTime(iso: string | null, now = new Date()): string {
  if (!iso) return ''
  const date = new Date(iso)
  const days = daysBetween(now, date)
  if (days <= 0) return formatTime(iso)
  if (days === 1) return 'вчера'
  if (days < 7) return date.toLocaleDateString(locale, { weekday: 'short' })
  return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Day separator inside a conversation: Сегодня · Вчера · 3 ноября · 3 ноября 2024 г. */
export function formatDayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const days = daysBetween(now, date)
  if (days === 0) return 'Сегодня'
  if (days === 1) return 'Вчера'
  return date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  })
}

export function formatRelative(iso: string, now = new Date()): string {
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000)
  if (seconds < 45) return 'только что'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')} назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`
  return formatDateTime(iso)
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function formatNumber(n: number): string {
  return n.toLocaleString(locale)
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} Б`
  const units = ['КБ', 'МБ', 'ГБ']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[unit]}`
}

export function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

const AVATAR_TONES = ['indigo', 'sky', 'teal', 'emerald', 'amber', 'orange', 'rose', 'violet'] as const
export type AvatarTone = (typeof AVATAR_TONES)[number]

export function avatarTone(id: number): AvatarTone {
  return AVATAR_TONES[Math.abs(id) % AVATAR_TONES.length]
}

export const KIND_LABEL: Record<ChatKind, string> = {
  user: 'Личный чат',
  bot: 'Бот',
  group: 'Группа',
  supergroup: 'Супергруппа',
  channel: 'Канал',
}

export const MEDIA_LABEL: Record<MediaKind, string> = {
  photo: 'Фото',
  video: 'Видео',
  document: 'Файл',
  audio: 'Аудио',
  voice: 'Голосовое сообщение',
  sticker: 'Стикер',
  gif: 'GIF',
  other: 'Вложение',
}

export const STATUS_LABEL: Record<AuditStatus, string> = {
  success: 'Выполнено',
  failed: 'Ошибка',
  skipped: 'Пропущено',
  dry_run: 'Тестовый режим',
}

const ACTION_LABEL: Record<string, string> = {
  'message.send': 'Отправлено сообщение',
  'file.send': 'Отправлен файл',
  'post.publish': 'Опубликован пост',
  'post.schedule': 'Запланирована публикация',
  'post.cancel': 'Отменена публикация',
  'auto.reply': 'Автоответ',
  'auth.login': 'Вход в Telegram',
  'auth.logout': 'Выход из Telegram',
  'auth.credentials': 'Сохранены ключи API',
  'automation.enable': 'Автоматизация включена',
  'automation.disable': 'Автоматизация выключена',
  'rule.create': 'Создано правило',
  'rule.update': 'Изменено правило',
  'rule.toggle': 'Переключено правило',
  'rule.delete': 'Удалено правило',
  'mode.switch': 'Смена режима',
  'activity.clear': 'Журнал очищен',
  'security.token_rotate': 'Обновлён ключ доступа',
  'ai.settings': 'Настройки ИИ обновлены',
  'ai.key': 'Сохранён ключ ИИ',
  'ai.key_delete': 'Удалён ключ ИИ',
  'archive.settings': 'Настройки архива',
  'archive.import': 'Импорт экспорта Telegram',
  'archive.clear': 'Очистка архива',
  'system.autostart': 'Автозапуск',
}

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action
}
