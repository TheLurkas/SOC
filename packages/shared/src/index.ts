// ── Constants ────────────────────────────────────────────────

export const SEVERITY_LEVELS = ['unknown', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITY_LEVELS)[number];

export const EVENT_TYPES = ['traffic', 'threat', 'system', 'config'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const LOG_ACTIONS = ['allow', 'deny', 'drop', 'reset'] as const;
export type LogAction = (typeof LOG_ACTIONS)[number];

export const USER_ROLES = ['admin', 'analyst'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ALERT_STATUSES = ['open', 'acknowledged', 'investigating', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const AUTO_RESPONSE_STATUSES = ['proposed', 'approved', 'executed', 'rejected'] as const;
export type AutoResponseStatus = (typeof AUTO_RESPONSE_STATUSES)[number];

// ── Generic API envelope ─────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  error?: string;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// ── User DTOs ────────────────────────────────────────────────

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface CreateUserDto {
  name: string;
  email: string;
  password: string;
  role: string;
}

export interface UpdateUserDto {
  name?: string;
  email?: string;
  role?: string;
  password?: string;
}

// ── Company DTOs ─────────────────────────────────────────────

export interface CompanyDto {
  id: string;
  name: string;
  contact: string | null;
  workspaces: number;
  createdAt: string;
}

export interface CompanyDetailDto {
  id: string;
  name: string;
  contact: string | null;
  createdAt: string;
  workspaces: WorkspaceDto[];
  workspaceCount: number;
}

export interface CreateCompanyDto {
  name: string;
  contact?: string;
}

// ── Workspace DTOs ───────────────────────────────────────────

export interface WorkspaceDto {
  id: string;
  name: string;
  description: string | null;
  autoResponseEnabled: boolean;
  createdAt: string;
}

export interface WorkspaceDetailDto extends WorkspaceDto {
  company: { id: string; name: string };
}

export interface CreateWorkspaceDto {
  name: string;
  description?: string;
}

// ── Log DTOs ─────────────────────────────────────────────────

export interface LogDto {
  id: string;
  workspaceId: string;
  timestamp: number;
  severity: string;
  vendor: string;
  eventType: string;
  action: string | null;
  application: string | null;
  protocol: string | null;
  policy: string | null;
  sourceIp: string | null;
  sourcePort: number | null;
  destinationIp: string | null;
  destinationPort: number | null;
  rawLog: string;
  createdAt: string;
}

export interface IngestLogDto {
  workspaceId: string;
  timestamp: number;
  severity?: string;
  vendor: string;
  eventType: string;
  action?: string | null;
  application?: string | null;
  protocol?: string | null;
  policy?: string | null;
  sourceIp?: string | null;
  sourcePort?: number | null;
  destinationIp?: string | null;
  destinationPort?: number | null;
  source?: { ip?: string; port?: number };
  destination?: { ip?: string; port?: number };
  rawLog: string;
}

export interface UpdateLogDto {
  severity?: string;
  vendor?: string;
  eventType?: string;
  action?: string;
  application?: string;
  protocol?: string;
  policy?: string;
}

export interface LogStatsDto {
  total: number;
  severity: { name: string; value: number }[];
  actions: { name: string; value: number }[];
  eventTypes: { name: string; value: number }[];
  vendors: { name: string; value: number }[];
  topSourceIps: { ip: string; count: number }[];
  topDestIps: { ip: string; count: number }[];
  volume: { time: string; count: number }[];
}

// ── Alert DTOs ──────────────────────────────────────────────

export interface AlertDto {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  assigneeId: string | null;
  assignee: { id: string; name: string; email: string } | null;
  workspace: { id: string; name: string; company: { id: string; name: string } };
  sourceIp: string | null;
  destinationIp: string | null;
  logCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateAlertDto {
  status?: string;
  assigneeId?: string | null;
}

export interface AlertStatsDto {
  total: number;
  open: number;
  acknowledged: number;
  investigating: number;
  resolved: number;
  bySeverity: { name: string; value: number }[];
}

export interface AlertNoteDto {
  id: string;
  alertId: string;
  content: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

export interface CreateAlertNoteDto {
  content: string;
}

export interface AlertActivityDto {
  id: string;
  alertId: string;
  action: string;
  detail: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
  alert: {
    id: string;
    title: string;
    severity: string;
    workspace: { id: string; name: string; company: { id: string; name: string } };
  };
}

// ── Dashboard DTOs ──────────────────────────────────────────

export interface DashboardStatsDto {
  totalLogs: number;
  logVolume: { hour: string; logs: number }[];
  alertsByDay: { day: string; critical: number; high: number; medium: number; low: number }[];
  alertsByCompany: { name: string; alerts: number }[];
}

// ── Analysis Rule DTOs ──────────────────────────────────────

export const RULE_CATEGORIES = ['general', 'threat', 'compliance', 'network', 'custom'] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export interface AnalysisRuleDto {
  id: string;
  title: string;
  content: string;
  category: string;
  enabled: boolean;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnalysisRuleDto {
  title: string;
  content: string;
  category?: string;
}

export interface UpdateAnalysisRuleDto {
  title?: string;
  content?: string;
  category?: string;
  enabled?: boolean;
}

// ── Notification DTOs ───────────────────────────────────────

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  alertId: string | null;
  read: boolean;
  createdAt: string;
}

// ── WebSocket Events ────────────────────────────────────────

export const WS_EVENTS = {
  LOGS_INGESTED: 'logs:ingested',
  LOG_UPDATED: 'log:updated',
  LOG_DELETED: 'log:deleted',
  LOGS_CLEARED: 'logs:cleared',
  JOIN_WORKSPACE: 'workspace:join',
  LEAVE_WORKSPACE: 'workspace:leave',
  ALERT_CREATED: 'alert:created',
  ALERT_UPDATED: 'alert:updated',
  JOIN_USER: 'user:join',
  NOTIFICATION_NEW: 'notification:new',
} as const;

export interface WsAlertPayload {
  alertId: string;
  workspaceId: string;
}

export interface WsLogsIngestedPayload {
  workspaceId: string;
  count: number;
}

export interface WsLogUpdatedPayload {
  workspaceId: string;
  logId: string;
}

export interface WsLogDeletedPayload {
  workspaceId: string;
  logId: string;
}

export interface WsLogsClearedPayload {
  workspaceId: string;
  deleted: number;
}

export interface WsNotificationPayload {
  userId: string;
  notification: NotificationDto;
}

// ── Chat DTOs ────────────────────────────────────────────────

export interface MessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  logsUsed?: number | null;
  createdAt?: string;
}

export interface ConversationDto {
  id: string;
  title: string;
  companyId: string | null;
  workspaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetailDto extends ConversationDto {
  messages: MessageDto[];
}

export interface ChatMention {
  type: 'company' | 'workspace';
  id: string;
  name: string;
}

export interface ChatRequestDto {
  message: string;
  conversationId?: string;
  companyId?: string;
  workspaceId?: string;
  mentions?: ChatMention[];
}

export interface ChatResponseDto {
  conversationId: string;
  title?: string;
  message: MessageDto;
  logsUsed: number;
}

export interface MentionSuggestionDto {
  type: 'company' | 'workspace';
  id: string;
  name: string;
}
