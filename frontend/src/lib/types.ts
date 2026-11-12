// Mirrors backend DTOs (backend/src/tpam/models.py).

export type Mode = 'demo' | 'telegram'
export type ChatKind = 'user' | 'bot' | 'group' | 'supergroup' | 'channel'
export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'not_configured' | 'unauthorized'
export type MediaKind = 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'sticker' | 'gif' | 'other'
export type AuditSource = 'manual' | 'automation' | 'system'
export type AuditStatus = 'success' | 'failed' | 'skipped' | 'dry_run'
export type MatchMode = 'any' | 'keywords' | 'regex'
export type ReplyMode = 'template' | 'ai'

export interface Account {
  id: number
  first_name: string
  last_name: string | null
  username: string | null
  phone_masked: string | null
  is_premium: boolean
}

export interface ProviderStatus {
  mode: Mode
  state: ConnectionState
  account: Account | null
  dc_id: number | null
  session_path: string | null
  device_model: string | null
  error: string | null
}

export interface Status {
  version: string
  mode: Mode
  connection: ProviderStatus
  automation_enabled: boolean
  updates_version: number
  is_owner: boolean
}

export interface Dialog {
  id: number
  title: string
  kind: ChatKind
  username: string | null
  unread_count: number
  pinned: boolean
  last_message_text: string | null
  last_message_date: string | null
  last_message_outgoing: boolean
  can_post: boolean
}

export interface DialogList {
  items: Dialog[]
  total: number
}

export interface Media {
  kind: MediaKind
  file_name: string | null
  size: number | null
  ttl: boolean
}

export interface Message {
  id: number
  chat_id: number
  date: string
  text: string
  outgoing: boolean
  sender_id: number | null
  sender_name: string | null
  reply_to_id: number | null
  media: Media | null
  views: number | null
  forwards: number | null
  edited: boolean
  service: boolean
  deleted: boolean
}

export interface MessagePage {
  items: Message[]
  next_before_id: number | null
}

export interface SearchHit {
  chat_id: number
  chat_title: string
  message: Message
}

export interface ChatDetails {
  id: number
  title: string
  kind: ChatKind
  username: string | null
  about: string | null
  participants_count: number | null
  is_admin: boolean
  is_creator: boolean
  can_send: boolean
  can_post: boolean
  can_view_participants: boolean
}

export interface Participant {
  id: number
  name: string
  username: string | null
  is_bot: boolean
  role: 'creator' | 'admin' | 'member'
}

export interface AuditRecord {
  id: number
  ts: string
  source: AuditSource
  action: string
  status: AuditStatus
  chat_id: number | null
  chat_title: string | null
  rule_id: number | null
  rule_name: string | null
  detail: string | null
  error_code: string | null
  duration_ms: number | null
}

export interface AuditPage {
  items: AuditRecord[]
  total: number
}

export interface RuleInput {
  name: string
  enabled: boolean
  dry_run: boolean
  private_only: boolean
  chat_ids: number[]
  match_mode: MatchMode
  keywords: string[]
  pattern: string
  reply_mode: ReplyMode
  reply_text: string
  ai_instructions: string
  cooldown_minutes: number
  daily_limit: number
}

export interface Rule extends RuleInput {
  id: number
  created_at: string
  updated_at: string
}

export interface AutomationLimits {
  global_per_hour: number
  global_per_day: number
  per_chat_per_hour: number
  min_cooldown_minutes: number
  max_message_age_seconds: number
}

export interface AutomationState {
  enabled: boolean
  limits: AutomationLimits
  sent_last_hour: number
  sent_last_day: number
}

export interface Overview {
  dialogs_total: number
  dialogs_loaded: number
  kinds: Record<ChatKind, number>
  unread_chats: number
  rules_total: number
  rules_enabled: number
  automation: AutomationState
  recent_activity: AuditRecord[]
}

export interface SystemInfo {
  version: string
  python_version: string
  telethon_version: string
  platform: string
  database_size_bytes: number
  audit_entries: number
  data_location: string
  secure_connection: boolean
  users_total: number | null
}

export interface AiSettings {
  persona: string
  knowledge: string
  max_reply_chars: number
  history_messages: number
}

export interface AiStatus {
  configured: boolean
  key_source: 'account' | null
  model: string
  settings: AiSettings
}

export interface AiResult {
  should_reply: boolean
  reply: string
  reason: string
  input_tokens: number
  output_tokens: number
}

export type ArchiveMediaMode = 'none' | 'photos' | 'all'
export type ArchiveFilter = 'all' | 'deleted' | 'edited'

export interface ArchiveSettings {
  enabled: boolean
  private_chats: boolean
  groups: boolean
  chat_ids: number[]
  media: ArchiveMediaMode
  max_media_mb: number
}

export interface ArchivedMessage {
  id: number
  chat_id: number
  chat_title: string | null
  message_id: number
  date: string
  sender_name: string | null
  outgoing: boolean
  text: string
  reply_to_id: number | null
  media: Media | null
  has_file: boolean
  edited_at: string | null
  deleted_at: string | null
  edit_count: number
  source: 'live' | 'import'
}

export interface ArchivePage {
  items: ArchivedMessage[]
  total: number
  next_cursor: number | null
}

export interface ArchiveChat {
  id: number
  title: string
  kind: ChatKind
  messages: number
  deleted: number
  edited: number
  last_date: string | null
}

export interface ArchiveStats {
  messages: number
  deleted: number
  edited: number
  chats: number
  media_files: number
  media_bytes: number
  database_bytes: number
}

export interface ArchiveEdit {
  old_text: string
  new_text: string
  edited_at: string
}

export interface ImportStatus {
  state: 'idle' | 'running' | 'done' | 'failed'
  path: string | null
  chats_done: number
  messages_imported: number
  messages_skipped: number
  current_chat: string | null
  error: string | null
  started_at: string | null
  finished_at: string | null
}

export interface Autostart {
  enabled: boolean
  supported: boolean
}

export interface SessionUser {
  id: number
  name: string
  username: string | null
  phone_masked: string | null
  is_owner: boolean
}

export interface LoginStep {
  step: 'code' | 'password' | 'done'
  phone_masked: string | null
  password_hint: string | null
}

export interface SessionInfo {
  signed_in: boolean
  kind: 'user' | 'guest' | null
  user: SessionUser | null
  registration_open: boolean
  server_configured: boolean
  setup_allowed: boolean
  login: LoginStep | null
}

export interface AdminUser {
  id: number
  name: string
  username: string | null
  phone_masked: string | null
  is_owner: boolean
  online: boolean
  created_at: string
  last_login_at: string
}

export interface AdminSummary {
  users: AdminUser[]
  registration_open: boolean
  max_users: number
  guests_active: number
}
