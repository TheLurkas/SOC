import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ChatRequestDto,
  ChatResponseDto,
  MessageDto,
  ConversationDto,
  ConversationDetailDto,
  MentionSuggestionDto,
  ChatMention,
} from '@soc/shared';

const getOpenAiConfig = () => ({
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.OPENAI_MODEL || 'gpt-5.1',
  apiKey: process.env.OPENAI_API_KEY || '',
});

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.1':      { input: 2.00,  output: 8.00  },
  'gpt-4.1':      { input: 2.00,  output: 8.00  },
  'gpt-4o':       { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':  { input: 0.15,  output: 0.60  },
  'gpt-4.1-mini': { input: 0.40,  output: 1.60  },
};

function calcCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-5.1'];
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}

// ── Types ────────────────────────────────────────────────────

interface ScopeConstraints {
  workspaceId?: string | null;
  companyId?: string | null;
  mentions?: ChatMention[];
}

interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

interface LlmUsageTokens {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface AgentResult {
  content: string;
  dataUsed: number;
  usage: LlmUsageTokens;
}

// ── Tool definitions ─────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_logs',
      description:
        'Search and filter security logs. Use for questions about network traffic, events, threats, actions, source/destination IPs, protocols, applications, vendors, or countries.',
      parameters: {
        type: 'object',
        properties: {
          where: {
            type: 'object',
            description:
              'Prisma where clause for the Log model. Fields: workspaceId (String), timestamp (Int, unix epoch), severity (unknown|low|medium|high|critical), vendor (String), eventType (String), action (String), application (String), protocol (String), sourceIp (String), destinationIp (String), srcCountry (String), dstCountry (String). Use Prisma operators: in, notIn, lt, lte, gt, gte, contains with mode:"insensitive".',
          },
          orderBy: {
            type: 'object',
            description: 'Sort order. Default: { "timestamp": "desc" }',
          },
          take: {
            type: 'number',
            description:
              'Max logs to return. Only set if the user asked for a specific number. Omit to let the system decide.',
          },
        },
        required: ['where'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_alerts',
      description:
        'Get security alerts. Use for questions about open/critical/resolved/investigating alerts, alert counts, incidents, who is assigned, alert history.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId:  { type: 'string', description: 'Filter by workspace ID' },
          companyId:    { type: 'string', description: 'Filter across all workspaces of this company ID' },
          status:       { type: 'string', enum: ['open', 'acknowledged', 'investigating', 'resolved'] },
          severity:     { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          assigneeId:   { type: 'string', description: 'Filter by assigned analyst user ID' },
          unassigned:   { type: 'boolean', description: 'If true, return only alerts with no assignee' },
          from:         { type: 'number', description: 'Unix timestamp — alerts created after this time' },
          to:           { type: 'number', description: 'Unix timestamp — alerts created before this time' },
          take:         { type: 'number', description: 'Max alerts to return (default 50)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_alert_detail',
      description:
        'Get full details of a specific alert including analyst notes and the complete activity timeline. Use when the user asks about a specific alert by ID or when you need notes/history.',
      parameters: {
        type: 'object',
        properties: {
          alertId: { type: 'string', description: 'The alert ID' },
        },
        required: ['alertId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_companies',
      description:
        'List client companies being monitored. Use for questions about clients, company names, how many companies exist, contact details.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Filter by name (case-insensitive partial match)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_workspaces',
      description:
        'List monitored environments (workspaces). Use for questions about environments, specific workspaces, auto-response status.',
      parameters: {
        type: 'object',
        properties: {
          companyId: { type: 'string', description: 'Filter by company ID' },
          search:    { type: 'string', description: 'Filter by name (case-insensitive partial match)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_users',
      description:
        'List SOC analysts and admins. Use for questions about team members, roles, who is on the team.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['admin', 'analyst'], description: 'Filter by role (omit for all)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_analysis_rules',
      description:
        'List analysis rules configured in the SOC platform. Use for questions about detection rules, what rules are active, etc.',
      parameters: {
        type: 'object',
        properties: {
          enabled:  { type: 'boolean', description: 'Filter by enabled status (omit for all)' },
          category: { type: 'string', description: 'Filter by category: general, threat, compliance, network, custom' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_usage_stats',
      description:
        'Get LLM/AI usage records — cost, token counts, API calls by model/purpose/user/company. Use for questions about AI spend, usage, or costs.',
      parameters: {
        type: 'object',
        properties: {
          from:      { type: 'number', description: 'Unix timestamp — start of period' },
          to:        { type: 'number', description: 'Unix timestamp — end of period' },
          companyId: { type: 'string', description: 'Filter by company ID' },
          userId:    { type: 'string', description: 'Filter by user ID' },
          purpose:   { type: 'string', description: 'Filter by purpose: query, answer, title, auto_response' },
          take:      { type: 'number', description: 'Max records to return (default 100)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_ip_reputation',
      description:
        'Look up cached AbuseIPDB reputation data for a specific IP address — abuse score, ISP, country, reports.',
      parameters: {
        type: 'object',
        properties: {
          ip: { type: 'string', description: 'IP address to look up' },
        },
        required: ['ip'],
      },
    },
  },
];

const MAX_AGENT_ROUNDS = 6;

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Conversation CRUD ────────────────────────────────────────

  async listConversations(userId: string): Promise<ConversationDto[]> {
    const convos = await this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return convos.map((c) => ({
      id: c.id,
      title: c.title,
      companyId: c.companyId,
      workspaceId: c.workspaceId,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  async getConversation(userId: string, conversationId: string): Promise<ConversationDetailDto> {
    const convo = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!convo) throw new HttpException('Conversation not found', HttpStatus.NOT_FOUND);

    return {
      id: convo.id,
      title: convo.title,
      companyId: convo.companyId,
      workspaceId: convo.workspaceId,
      createdAt: convo.createdAt.toISOString(),
      updatedAt: convo.updatedAt.toISOString(),
      messages: convo.messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        dataUsed: (m as any).dataUsed,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async deleteConversation(userId: string, conversationId: string): Promise<void> {
    const convo = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!convo) throw new HttpException('Conversation not found', HttpStatus.NOT_FOUND);
    await this.prisma.conversation.delete({ where: { id: conversationId } });
  }

  // ── @mention autocomplete ─────────────────────────────────────

  async getSuggestions(query: string, companyId?: string, workspaceId?: string): Promise<MentionSuggestionDto[]> {
    const results: MentionSuggestionDto[] = [];

    if (workspaceId && companyId) {
      const workspaces = await this.prisma.workspace.findMany({
        where: { companyId, name: { contains: query, mode: 'insensitive' } },
        take: 10,
        orderBy: { name: 'asc' },
      });
      for (const ws of workspaces) {
        results.push({ type: 'workspace', id: ws.id, name: ws.name });
      }
    } else if (companyId) {
      const workspaces = await this.prisma.workspace.findMany({
        where: { companyId, name: { contains: query, mode: 'insensitive' } },
        take: 10,
        orderBy: { name: 'asc' },
      });
      for (const ws of workspaces) {
        results.push({ type: 'workspace', id: ws.id, name: ws.name });
      }
    } else {
      const companies = await this.prisma.company.findMany({
        where: { name: { contains: query, mode: 'insensitive' } },
        take: 8,
        orderBy: { name: 'asc' },
      });
      for (const c of companies) {
        results.push({ type: 'company', id: c.id, name: c.name });
      }
      const workspaces = await this.prisma.workspace.findMany({
        where: { name: { contains: query, mode: 'insensitive' } },
        take: 5,
        orderBy: { name: 'asc' },
        include: { company: { select: { name: true } } },
      });
      for (const ws of workspaces) {
        results.push({ type: 'workspace', id: ws.id, name: `${ws.name} (${ws.company.name})` });
      }
    }

    return results;
  }

  // ── Send message ──────────────────────────────────────────────

  async sendMessage(userId: string, dto: ChatRequestDto): Promise<ChatResponseDto> {
    const { message, conversationId, companyId, workspaceId, mentions } = dto;

    let convo: any;
    if (conversationId) {
      convo = await this.prisma.conversation.findFirst({
        where: { id: conversationId, userId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      if (!convo) throw new HttpException('Conversation not found', HttpStatus.NOT_FOUND);
    } else {
      convo = await this.prisma.conversation.create({
        data: { userId, companyId: companyId || null, workspaceId: workspaceId || null },
        include: { messages: true },
      });
    }

    await this.prisma.message.create({
      data: { conversationId: convo.id, role: 'user', content: message },
    });

    const history: LlmMessage[] = convo.messages.map((m: any) => ({
      role: m.role,
      content: m.content,
    }));

    const effectiveCompanyId = companyId || convo.companyId;
    const effectiveWorkspaceId = workspaceId || convo.workspaceId;

    const scope: ScopeConstraints = {
      workspaceId: effectiveWorkspaceId,
      companyId: effectiveCompanyId,
      mentions,
    };

    const usageCtx = {
      userId,
      companyId: effectiveCompanyId || null,
      workspaceId: effectiveWorkspaceId || null,
      conversationId: convo.id,
    };

    const agentResult = await this.runAgentLoop(message, history, scope, usageCtx);

    const assistantMsg = await this.prisma.message.create({
      data: {
        conversationId: convo.id,
        role: 'assistant',
        content: agentResult.content,
        dataUsed: agentResult.dataUsed,
      } as any,
    });

    let title: string | undefined;
    if (convo.messages.length === 0) {
      title = await this.generateTitle(message, convo.id, usageCtx);
    }

    await this.prisma.conversation.update({
      where: { id: convo.id },
      data: { updatedAt: new Date() },
    });

    return {
      conversationId: convo.id,
      title,
      message: {
        id: assistantMsg.id,
        role: 'assistant',
        content: agentResult.content,
        dataUsed: agentResult.dataUsed,
        createdAt: assistantMsg.createdAt.toISOString(),
      },
      dataUsed: agentResult.dataUsed,
    };
  }

  // ── Agentic loop ──────────────────────────────────────────────

  private async runAgentLoop(
    userMessage: string,
    history: LlmMessage[],
    scope: ScopeConstraints,
    usageCtx: any,
  ): Promise<AgentResult> {
    const now = Math.floor(Date.now() / 1000);
    const nowHuman = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Athens', dateStyle: 'long', timeStyle: 'short' });

    const scopeDesc = this.buildScopeDescription(scope);

    const systemPrompt = `You are Lurka, an AI analyst assistant for a SOC (Security Operations Center) platform.
You have direct access to the platform database via tools. Always call tools to retrieve real data before answering — never guess or fabricate.

CURRENT CONTEXT:
- Time: ${nowHuman} (Europe/Athens timezone, Unix: ${now})
- Scope: ${scopeDesc}

TOOLS AVAILABLE:
- search_logs: network/security log records (traffic, threats, events, IPs, protocols, countries)
- get_alerts: security alerts by status, severity, assignee, time range
- get_alert_detail: full alert with notes and activity timeline
- get_companies: client companies list
- get_workspaces: monitored environments
- get_users: SOC team members and roles
- get_analysis_rules: configured detection rules
- get_usage_stats: AI/LLM cost and usage records
- get_ip_reputation: AbuseIPDB cached reputation for a specific IP

GUIDELINES:
- Call multiple tools in parallel when the question needs data from different sources.
- For multi-hop questions (e.g. "which company had the most critical alerts?"), use earlier results to inform later tool calls.
- When the user asks about a specific IP, always call get_ip_reputation alongside any log search.
- Be concise and precise. No filler, no preamble. Reference specific data (IPs, counts, names, timestamps) in your answers.
- Show all dates and times in Europe/Athens timezone in human-readable format (e.g. "March 10 at 14:35").
- Use plain text. No markdown headers. Short paragraphs.
- If no data matches, say so briefly and suggest what might help.
- If something looks genuinely alarming, flag it even if not asked.`;

    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage },
    ];

    let dataUsed = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
      const { choice, usage } = await this.callLlmWithTools(messages);

      totalPromptTokens += usage.prompt_tokens || 0;
      totalCompletionTokens += usage.completion_tokens || 0;

      if (choice.finish_reason === 'stop' || !choice.message.tool_calls?.length) {
        // Final answer
        const content = choice.message.content ?? '';
        this.recordUsage(
          { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens: totalPromptTokens + totalCompletionTokens },
          'answer',
          usageCtx,
        );
        return { content, dataUsed, usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens: totalPromptTokens + totalCompletionTokens } };
      }

      // Execute all tool calls (parallel)
      const assistantMsg: LlmMessage = {
        role: 'assistant',
        content: choice.message.content ?? null,
        tool_calls: choice.message.tool_calls,
      };
      messages.push(assistantMsg);

      const toolResults = await Promise.all(
        choice.message.tool_calls.map(async (tc: any) => {
          let args: any = {};
          try { args = JSON.parse(tc.function.arguments); } catch { /* bad json from llm */ }

          const { data, count } = await this.executeTool(tc.function.name, args, scope);
          dataUsed += count;

          return {
            role: 'tool' as const,
            tool_call_id: tc.id,
            name: tc.function.name,
            content: JSON.stringify(data),
          };
        }),
      );

      messages.push(...toolResults);
    }

    // Shouldn't reach here but just in case
    return { content: 'I was unable to complete the analysis within the allowed number of steps. Please try a more specific question.', dataUsed, usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens: totalPromptTokens + totalCompletionTokens } };
  }

  // ── Scope helpers ─────────────────────────────────────────────

  private buildScopeDescription(scope: ScopeConstraints): string {
    const { workspaceId, companyId, mentions } = scope;
    if (mentions?.length) {
      const parts = mentions.map((m) => `${m.type} "${m.name}" (${m.id})`).join(', ');
      return `User mentioned: ${parts}. Queries are constrained to these entities.`;
    }
    if (workspaceId) return `Workspace scoped (ID: ${workspaceId})`;
    if (companyId) return `Company scoped (ID: ${companyId})`;
    return 'Global — all companies and workspaces';
  }

  // Injects scope constraints into a where clause for logs/alerts.
  // Mention scope > page workspace > page company > global.
  private injectLogScope(where: any, scope: ScopeConstraints): any {
    const { workspaceId, companyId, mentions } = scope;
    if (mentions?.length) {
      const wsIds = mentions.filter((m) => m.type === 'workspace').map((m) => m.id);
      const coIds = mentions.filter((m) => m.type === 'company').map((m) => m.id);
      if (wsIds.length) where.workspaceId = { in: wsIds };
      else if (coIds.length) where.workspace = { companyId: { in: coIds } };
    } else if (workspaceId) {
      where.workspaceId = workspaceId;
    } else if (companyId) {
      where.workspace = { ...(where.workspace ?? {}), companyId };
    }
    return where;
  }

  private injectAlertScope(where: any, args: any, scope: ScopeConstraints): any {
    const { workspaceId, companyId, mentions } = scope;
    if (mentions?.length) {
      const wsIds = mentions.filter((m) => m.type === 'workspace').map((m) => m.id);
      const coIds = mentions.filter((m) => m.type === 'company').map((m) => m.id);
      if (wsIds.length) where.workspaceId = { in: wsIds };
      else if (coIds.length) where.workspace = { companyId: { in: coIds } };
    } else if (workspaceId) {
      where.workspaceId = workspaceId;
    } else if (companyId) {
      where.workspace = { companyId };
    } else {
      // global — trust the LLM's args
      if (args.workspaceId) where.workspaceId = args.workspaceId;
      if (args.companyId) where.workspace = { companyId: args.companyId };
    }
    return where;
  }

  // ── Tool executor ─────────────────────────────────────────────

  private async executeTool(name: string, args: any, scope: ScopeConstraints): Promise<{ data: any; count: number }> {
    try {
      switch (name) {
        case 'search_logs': return await this.toolSearchLogs(args, scope);
        case 'get_alerts': return await this.toolGetAlerts(args, scope);
        case 'get_alert_detail': return await this.toolGetAlertDetail(args);
        case 'get_companies': return await this.toolGetCompanies(args);
        case 'get_workspaces': return await this.toolGetWorkspaces(args);
        case 'get_users': return await this.toolGetUsers(args);
        case 'get_analysis_rules': return await this.toolGetAnalysisRules(args);
        case 'get_usage_stats': return await this.toolGetUsageStats(args);
        case 'get_ip_reputation': return await this.toolGetIpReputation(args);
        default:
          this.logger.warn(`Unknown tool: ${name}`);
          return { data: { error: `Unknown tool: ${name}` }, count: 0 };
      }
    } catch (err) {
      this.logger.error(`Tool ${name} failed: ${err}`);
      return { data: { error: String(err) }, count: 0 };
    }
  }

  private async toolSearchLogs(args: any, scope: ScopeConstraints) {
    const { where = {}, orderBy = { timestamp: 'desc' }, take } = args;
    this.injectLogScope(where, scope);

    const logs = await this.prisma.log.findMany({
      where,
      orderBy,
      ...(take ? { take: Math.min(take, 2000) } : { take: 500 }),
      select: {
        id: true, timestamp: true, severity: true, vendor: true, eventType: true,
        action: true, application: true, protocol: true, policy: true,
        sourceIp: true, sourcePort: true, destinationIp: true, destinationPort: true,
        srcCountry: true, dstCountry: true, rawLog: true,
        workspace: { select: { id: true, name: true, company: { select: { id: true, name: true } } } },
      },
    });

    // Aggregate summary + sample to keep response size manageable
    const total = logs.length;
    const bySeverity: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    const byVendor: Record<string, number> = {};
    const byCountry: Record<string, number> = {};
    const srcIps: Record<string, number> = {};
    const dstIps: Record<string, number> = {};
    let minTs = Infinity, maxTs = -Infinity;

    for (const l of logs) {
      bySeverity[l.severity] = (bySeverity[l.severity] || 0) + 1;
      if (l.action) byAction[l.action] = (byAction[l.action] || 0) + 1;
      byVendor[l.vendor] = (byVendor[l.vendor] || 0) + 1;
      if (l.srcCountry) byCountry[l.srcCountry] = (byCountry[l.srcCountry] || 0) + 1;
      if (l.sourceIp) srcIps[l.sourceIp] = (srcIps[l.sourceIp] || 0) + 1;
      if (l.destinationIp) dstIps[l.destinationIp] = (dstIps[l.destinationIp] || 0) + 1;
      if (l.timestamp < minTs) minTs = l.timestamp;
      if (l.timestamp > maxTs) maxTs = l.timestamp;
    }

    const topN = (map: Record<string, number>, n: number) =>
      Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ value: k, count: v }));

    const sample = logs.slice(0, 60).map((l) => ({
      id: l.id,
      time: new Date(l.timestamp * 1000).toISOString(),
      severity: l.severity,
      vendor: l.vendor,
      event: l.eventType,
      action: l.action,
      app: l.application,
      proto: l.protocol,
      src: l.sourceIp ? `${l.sourceIp}:${l.sourcePort ?? ''}` : null,
      dst: l.destinationIp ? `${l.destinationIp}:${l.destinationPort ?? ''}` : null,
      srcCountry: l.srcCountry,
      dstCountry: l.dstCountry,
      workspace: (l as any).workspace?.name,
      company: (l as any).workspace?.company?.name,
    }));

    return {
      data: {
        total,
        timeRange: total > 0 ? { from: new Date(minTs * 1000).toISOString(), to: new Date(maxTs * 1000).toISOString() } : null,
        bySeverity: topN(bySeverity, 10),
        byAction: topN(byAction, 10),
        byVendor: topN(byVendor, 10),
        topSourceCountries: topN(byCountry, 15),
        topSourceIps: topN(srcIps, 15),
        topDestinationIps: topN(dstIps, 15),
        sample,
      },
      count: total,
    };
  }

  private async toolGetAlerts(args: any, scope: ScopeConstraints) {
    const { status, severity, assigneeId, unassigned, from, to, take = 50 } = args;
    const where: any = {};

    this.injectAlertScope(where, args, scope);

    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (assigneeId) where.assigneeId = assigneeId;
    if (unassigned) where.assigneeId = null;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from * 1000);
      if (to) where.createdAt.lte = new Date(to * 1000);
    }

    const alerts = await this.prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 200),
      include: {
        workspace: { select: { id: true, name: true, company: { select: { id: true, name: true } } } },
        assignee: { select: { id: true, name: true, email: true } },
        _count: { select: { notes: true, activities: true } },
      },
    });

    // Status/severity summary
    const byStatus: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const a of alerts) {
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
    }

    return {
      data: {
        total: alerts.length,
        byStatus,
        bySeverity,
        alerts: alerts.map((a) => ({
          id: a.id,
          title: a.title,
          description: a.description,
          severity: a.severity,
          status: a.status,
          sourceIp: a.sourceIp,
          destinationIp: a.destinationIp,
          logCount: a.logCount,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
          workspace: (a as any).workspace?.name,
          company: (a as any).workspace?.company?.name,
          assignee: (a as any).assignee?.name ?? null,
          notesCount: (a as any)._count?.notes ?? 0,
        })),
      },
      count: alerts.length,
    };
  }

  private async toolGetAlertDetail(args: any) {
    const { alertId } = args;
    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId },
      include: {
        workspace: { select: { name: true, company: { select: { name: true } } } },
        assignee: { select: { name: true, email: true, role: true } },
        notes: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { name: true } } },
        },
        activities: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { name: true } } },
        },
      },
    });

    if (!alert) return { data: { error: `Alert ${alertId} not found` }, count: 0 };

    return {
      data: {
        id: alert.id,
        title: alert.title,
        description: alert.description,
        severity: alert.severity,
        status: alert.status,
        sourceIp: alert.sourceIp,
        destinationIp: alert.destinationIp,
        logCount: alert.logCount,
        createdAt: alert.createdAt.toISOString(),
        updatedAt: alert.updatedAt.toISOString(),
        workspace: (alert as any).workspace?.name,
        company: (alert as any).workspace?.company?.name,
        assignee: (alert as any).assignee ? { name: (alert as any).assignee.name, email: (alert as any).assignee.email, role: (alert as any).assignee.role } : null,
        notes: (alert as any).notes.map((n: any) => ({ author: n.user.name, content: n.content, createdAt: n.createdAt.toISOString() })),
        timeline: (alert as any).activities.map((a: any) => ({ actor: a.user.name, action: a.action, detail: a.detail, createdAt: a.createdAt.toISOString() })),
      },
      count: 1,
    };
  }

  private async toolGetCompanies(args: any) {
    const where: any = {};
    if (args.search) where.name = { contains: args.search, mode: 'insensitive' };

    const companies = await this.prisma.company.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { workspaces: true } },
      },
    });

    return {
      data: companies.map((c) => ({
        id: c.id,
        name: c.name,
        contact: c.contact,
        workspaceCount: (c as any)._count.workspaces,
        createdAt: c.createdAt.toISOString(),
      })),
      count: companies.length,
    };
  }

  private async toolGetWorkspaces(args: any) {
    const where: any = {};
    if (args.companyId) where.companyId = args.companyId;
    if (args.search) where.name = { contains: args.search, mode: 'insensitive' };

    const workspaces = await this.prisma.workspace.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        company: { select: { id: true, name: true } },
        _count: { select: { logs: true, alerts: true } },
      },
    });

    return {
      data: workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        autoResponseEnabled: w.autoResponseEnabled,
        company: (w as any).company.name,
        companyId: (w as any).company.id,
        logCount: (w as any)._count.logs,
        alertCount: (w as any)._count.alerts,
        createdAt: w.createdAt.toISOString(),
      })),
      count: workspaces.length,
    };
  }

  private async toolGetUsers(args: any) {
    const where: any = {};
    if (args.role) where.role = args.role;

    const users = await this.prisma.user.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        _count: { select: { assignedAlerts: true, conversations: true } },
      },
    });

    return {
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        assignedAlerts: (u as any)._count.assignedAlerts,
        conversations: (u as any)._count.conversations,
        joinedAt: u.createdAt.toISOString(),
      })),
      count: users.length,
    };
  }

  private async toolGetAnalysisRules(args: any) {
    const where: any = {};
    if (args.enabled !== undefined) where.enabled = args.enabled;
    if (args.category) where.category = args.category;

    const rules = await this.prisma.analysisRule.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { createdBy: { select: { name: true } } },
    });

    return {
      data: rules.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        category: r.category,
        enabled: r.enabled,
        createdBy: (r as any).createdBy.name,
        createdAt: r.createdAt.toISOString(),
      })),
      count: rules.length,
    };
  }

  private async toolGetUsageStats(args: any) {
    const { from, to, companyId, userId, purpose, take = 100 } = args;
    const where: any = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from * 1000);
      if (to) where.createdAt.lte = new Date(to * 1000);
    }
    if (companyId) where.companyId = companyId;
    if (userId) where.userId = userId;
    if (purpose) where.purpose = purpose;

    const records = await this.prisma.llmUsage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 500),
      include: {
        user: { select: { name: true } },
        company: { select: { name: true } },
      },
    });

    // Aggregate totals
    const totals = records.reduce(
      (acc, r) => {
        acc.totalCostUsd += r.costUsd;
        acc.totalTokens += r.totalTokens;
        acc.totalCalls += 1;
        return acc;
      },
      { totalCostUsd: 0, totalTokens: 0, totalCalls: 0 },
    );

    const byPurpose: Record<string, { calls: number; costUsd: number; tokens: number }> = {};
    const byModel: Record<string, { calls: number; costUsd: number }> = {};
    for (const r of records) {
      if (!byPurpose[r.purpose]) byPurpose[r.purpose] = { calls: 0, costUsd: 0, tokens: 0 };
      byPurpose[r.purpose].calls++;
      byPurpose[r.purpose].costUsd += r.costUsd;
      byPurpose[r.purpose].tokens += r.totalTokens;
      if (!byModel[r.model]) byModel[r.model] = { calls: 0, costUsd: 0 };
      byModel[r.model].calls++;
      byModel[r.model].costUsd += r.costUsd;
    }

    return {
      data: {
        totals: { ...totals, totalCostUsd: Math.round(totals.totalCostUsd * 10000) / 10000 },
        byPurpose,
        byModel,
        recent: records.slice(0, 20).map((r) => ({
          model: r.model,
          purpose: r.purpose,
          costUsd: r.costUsd,
          totalTokens: r.totalTokens,
          user: (r as any).user?.name ?? null,
          company: (r as any).company?.name ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      },
      count: records.length,
    };
  }

  private async toolGetIpReputation(args: any) {
    const { ip } = args;
    const rep = await this.prisma.ipReputation.findUnique({ where: { ip } });

    if (!rep) {
      return { data: { ip, found: false, message: 'No reputation data cached for this IP. The reputation service may not have checked it yet.' }, count: 0 };
    }

    return {
      data: {
        ip: rep.ip,
        found: true,
        abuseScore: rep.abuseScore,
        countryCode: rep.countryCode,
        isp: rep.isp,
        domain: rep.domain,
        usageType: rep.usageType,
        totalReports: rep.totalReports,
        lastReportedAt: rep.lastReportedAt?.toISOString() ?? null,
        isPublic: rep.isPublic,
        isWhitelisted: rep.isWhitelisted,
        checkedAt: rep.checkedAt.toISOString(),
      },
      count: 1,
    };
  }

  // ── Title generation ──────────────────────────────────────────

  private async generateTitle(firstMessage: string, conversationId: string, usageCtx?: any): Promise<string | undefined> {
    try {
      const result = await this.callLlmSimple([
        { role: 'system', content: 'Generate a short title (max 6 words) for a SOC chat conversation based on the user\'s first message. Return ONLY the title text, nothing else. No quotes.' },
        { role: 'user', content: firstMessage },
      ]);
      if (usageCtx) this.recordUsage(result, 'title', usageCtx);
      const title = result.content.trim().replace(/^["']|["']$/g, '').slice(0, 80);
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { title } });
      return title;
    } catch (err) {
      this.logger.warn(`Failed to generate title: ${err}`);
      return undefined;
    }
  }

  // ── LLM callers ───────────────────────────────────────────────

  private async callLlmWithTools(messages: LlmMessage[]): Promise<{ choice: any; usage: any }> {
    const { baseUrl, model, apiKey } = getOpenAiConfig();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2 }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    return { choice: data.choices?.[0], usage: data.usage || {} };
  }

  private async callLlmSimple(messages: { role: string; content: string }[]): Promise<{ content: string; promptTokens: number; completionTokens: number; totalTokens: number }> {
    const { baseUrl, model, apiKey } = getOpenAiConfig();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.2 }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const usage = data.usage || {};
    return {
      content: data.choices?.[0]?.message?.content || '',
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    };
  }

  // ── Usage recording ───────────────────────────────────────────

  private async recordUsage(
    result: { promptTokens: number; completionTokens: number; totalTokens: number },
    purpose: string,
    ctx: { userId?: string; companyId?: string | null; workspaceId?: string | null; conversationId?: string },
  ) {
    const model = getOpenAiConfig().model;
    const costUsd = calcCostUsd(model, result.promptTokens, result.completionTokens);
    try {
      await this.prisma.llmUsage.create({
        data: {
          userId: ctx.userId || null,
          companyId: ctx.companyId || null,
          workspaceId: ctx.workspaceId || null,
          conversationId: ctx.conversationId || null,
          model,
          purpose,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: result.totalTokens,
          costUsd,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to record LLM usage: ${err}`);
    }
  }
}
