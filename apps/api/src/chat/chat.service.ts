import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ChatRequestDto, ChatResponseDto, MessageDto, ConversationDto, ConversationDetailDto, MentionSuggestionDto, ChatMention } from '@soc/shared';

// read at call time so dotenv is guaranteed to have loaded
const getOpenAiConfig = () => ({
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.OPENAI_MODEL || 'gpt-5.1',
  apiKey: process.env.OPENAI_API_KEY || '',
});

const LOG_SCHEMA = `
Table: logs
Columns:
  id             String (cuid)
  workspaceId    String
  timestamp      Int (Unix epoch seconds)
  severity       String (unknown | low | medium | high | critical)
  vendor         String (e.g. "paloalto")
  eventType      String (e.g. "traffic", "threat", "system")
  action         String? (e.g. "allow", "deny", "drop")
  application    String? (e.g. "soap", "ssl", "web-browsing")
  protocol       String? (e.g. "tcp", "udp")
  policy         String? (e.g. "Allow Tap Traffic")
  sourceIp       String?
  sourcePort     Int?
  destinationIp  String?
  destinationPort Int?
  rawLog         String (full raw syslog text)
  createdAt      DateTime

Table: workspaces
Columns:
  id          String (cuid)
  companyId   String
  name        String

Relation: logs.workspaceId -> workspaces.id
`;

interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LlmResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// GPT-5.1 pricing (per 1M tokens) — update if model changes
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.1': { input: 2.00, output: 8.00 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
};

function calcCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gpt-5.1'];
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Conversation CRUD ──────────────────────────────────────

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
        logsUsed: m.logsUsed,
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

  // ── @mention autocomplete ──────────────────────────────────

  async getSuggestions(query: string, companyId?: string, workspaceId?: string): Promise<MentionSuggestionDto[]> {
    const results: MentionSuggestionDto[] = [];

    if (workspaceId && companyId) {
      // inside a workspace: suggest sibling workspaces of the same company
      const workspaces = await this.prisma.workspace.findMany({
        where: { companyId, name: { contains: query, mode: 'insensitive' } },
        take: 10,
        orderBy: { name: 'asc' },
      });
      for (const ws of workspaces) {
        results.push({ type: 'workspace', id: ws.id, name: ws.name });
      }
    } else if (companyId) {
      // inside a company: suggest workspaces of this company
      const workspaces = await this.prisma.workspace.findMany({
        where: { companyId, name: { contains: query, mode: 'insensitive' } },
        take: 10,
        orderBy: { name: 'asc' },
      });
      for (const ws of workspaces) {
        results.push({ type: 'workspace', id: ws.id, name: ws.name });
      }
    } else {
      // dashboard: suggest companies first, then workspaces
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

  // ── Send message (the main flow) ──────────────────────────

  async sendMessage(userId: string, dto: ChatRequestDto): Promise<ChatResponseDto> {
    const { message, conversationId, companyId, workspaceId, mentions } = dto;

    // get or create conversation
    let convo: any;
    if (conversationId) {
      convo = await this.prisma.conversation.findFirst({
        where: { id: conversationId, userId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      if (!convo) throw new HttpException('Conversation not found', HttpStatus.NOT_FOUND);
    } else {
      convo = await this.prisma.conversation.create({
        data: {
          userId,
          companyId: companyId || null,
          workspaceId: workspaceId || null,
        },
        include: { messages: true },
      });
    }

    // save user message
    const userMsg = await this.prisma.message.create({
      data: {
        conversationId: convo.id,
        role: 'user',
        content: message,
      },
    });

    // build history from DB
    const history: MessageDto[] = convo.messages.map((m: any) => ({
      id: m.id,
      role: m.role,
      content: m.content,
    }));

    const effectiveCompanyId = companyId || convo.companyId;
    const effectiveWorkspaceId = workspaceId || convo.workspaceId;

    const usageCtx = {
      userId,
      companyId: effectiveCompanyId || null,
      workspaceId: effectiveWorkspaceId || null,
      conversationId: convo.id,
    };

    // call 1: generate query
    const queryJson = await this.generateQuery(message, effectiveCompanyId, effectiveWorkspaceId, history, mentions, usageCtx);

    // execute query — mentions override scope
    const logs = await this.executePrismaQuery(queryJson, effectiveCompanyId, effectiveWorkspaceId, mentions);

    // call 2: generate answer
    const reply = await this.generateAnswer(message, logs, history, usageCtx);

    // save assistant message
    const assistantMsg = await this.prisma.message.create({
      data: {
        conversationId: convo.id,
        role: 'assistant',
        content: reply,
        logsUsed: logs.length,
      },
    });

    // auto-title on first message, then bump updatedAt
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
        content: reply,
        logsUsed: logs.length,
        createdAt: assistantMsg.createdAt.toISOString(),
      },
      logsUsed: logs.length,
    };
  }

  // ── Title generation ────────────────────────────────────────

  private async generateTitle(firstMessage: string, conversationId: string, usageCtx?: any): Promise<string | undefined> {
    try {
      const result = await this.callLlm([
        {
          role: 'system',
          content: 'Generate a short title (max 6 words) for a SOC chat conversation based on the user\'s first message. Return ONLY the title text, nothing else. No quotes.',
        },
        { role: 'user', content: firstMessage },
      ]);
      if (usageCtx) this.recordUsage(result, 'title', usageCtx);
      const title = result.content.trim().replace(/^["']|["']$/g, '').slice(0, 80);
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { title },
      });
      return title;
    } catch (err) {
      this.logger.warn(`Failed to generate title: ${err}`);
      return undefined;
    }
  }

  // ── LLM query generation ──────────────────────────────────

  private async generateQuery(
    message: string,
    companyId?: string | null,
    workspaceId?: string | null,
    history?: MessageDto[],
    mentions?: ChatMention[],
    usageCtx?: any,
  ): Promise<any> {
    const contextParts: string[] = [];

    // mentions override normal scope
    if (mentions?.length) {
      const companyMentions = mentions.filter((m) => m.type === 'company');
      const workspaceMentions = mentions.filter((m) => m.type === 'workspace');
      if (workspaceMentions.length) {
        const ids = workspaceMentions.map((m) => `"${m.id}"`).join(', ');
        const names = workspaceMentions.map((m) => m.name).join(', ');
        contextParts.push(`The user mentioned specific workspaces: ${names}. Filter by workspaceId IN [${ids}].`);
      }
      if (companyMentions.length) {
        const ids = companyMentions.map((m) => `"${m.id}"`).join(', ');
        const names = companyMentions.map((m) => m.name).join(', ');
        contextParts.push(`The user mentioned specific companies: ${names}. Filter by workspace: { companyId: { in: [${ids}] } }.`);
      }
    } else if (workspaceId) {
      contextParts.push(`The user is viewing workspace ID: "${workspaceId}"`);
    } else if (companyId) {
      contextParts.push(`The user is viewing company ID: "${companyId}". Query logs across ALL workspaces belonging to this company.`);
    } else {
      contextParts.push('No specific workspace/company selected. Query across all logs.');
    }

    const systemPrompt = `You are a database query assistant for a SOC (Security Operations Center) platform.
Given a user's question about security logs, generate a Prisma "where" clause (as JSON) and optional ordering/limit to retrieve the relevant logs.

${LOG_SCHEMA}

RULES:
- Return ONLY valid JSON. No markdown, no explanation, no code fences, no text before or after.
- The JSON must have this exact shape: { "where": {}, "orderBy": {}, "take": number }
- "where" is a Prisma where clause for the Log model.
- "orderBy" defaults to { "timestamp": "desc" } if not specified.
- "take" is optional. Omit it to retrieve ALL matching logs. Only set it if the user explicitly asks for a specific number (e.g. "show me the last 50").
- ${contextParts.join(' ')}
- ${!mentions?.length && workspaceId ? `Always include workspaceId: "${workspaceId}" in the where clause.` : ''}
- ${!mentions?.length && companyId && !workspaceId ? `To filter by company, use: workspace: { companyId: "${companyId}" }` : ''}
- For time-based queries, "timestamp" is Unix epoch (seconds). Current time is approximately ${Math.floor(Date.now() / 1000)}.
- When the user mentions dates/times, assume they are referring to Europe/Athens (Greece) timezone (UTC+2 / UTC+3 DST). Convert accordingly to Unix epoch.
- Use Prisma operators: equals, not, in, notIn, lt, lte, gt, gte, contains (for string search), mode: "insensitive" for case-insensitive.
- For "latest" or "recent" queries without a specific count, just use orderBy desc without a take limit.
- For severity filtering, valid values are: unknown, low, medium, high, critical (lowercase).
- For string matching on fields like eventType, vendor, action, application — use contains with mode: "insensitive" so casing doesn't matter.

EXAMPLES:

User: "show me denied traffic" (workspace scoped to "ws123")
{"where":{"workspaceId":"ws123","action":"deny"},"orderBy":{"timestamp":"desc"}}

User: "any critical alerts in @Acme Corp?" (company mention with id "comp1")
{"where":{"severity":"critical","workspace":{"companyId":{"in":["comp1"]}}},"orderBy":{"timestamp":"desc"}}

User: "show logs from last hour"  (workspace "ws456", current time ~1741800000)
{"where":{"workspaceId":"ws456","timestamp":{"gte":1741796400}},"orderBy":{"timestamp":"desc"}}

User: "what happened today" (no scope)
{"where":{"timestamp":{"gte":${Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)}}}, "orderBy":{"timestamp":"desc"}}`;

    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (history?.length) {
      for (const msg of history.slice(-6)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: message });

    const result = await this.callLlm(messages);
    if (usageCtx) this.recordUsage(result, 'query', usageCtx);

    try {
      // strip markdown fences, leading/trailing text around the JSON
      let cleaned = result.content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
      // extract the first JSON object if there's extra text
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleaned = jsonMatch[0];
      return JSON.parse(cleaned);
    } catch {
      this.logger.warn(`LLM returned unparseable query, falling back to default. Raw: ${result.content}`);
      const fallback: any = { where: {}, orderBy: { timestamp: 'desc' } };
      if (workspaceId) fallback.where.workspaceId = workspaceId;
      if (companyId && !workspaceId) fallback.where.workspace = { companyId };
      return fallback;
    }
  }

  // ── Query execution ───────────────────────────────────────

  private async executePrismaQuery(queryJson: any, companyId?: string | null, workspaceId?: string | null, mentions?: ChatMention[]) {
    const { where = {}, orderBy = { timestamp: 'desc' }, take } = queryJson;

    if (mentions?.length) {
      // mentions override normal scoping
      const wsIds = mentions.filter((m) => m.type === 'workspace').map((m) => m.id);
      const coIds = mentions.filter((m) => m.type === 'company').map((m) => m.id);
      const conditions: any[] = [];
      if (wsIds.length) conditions.push({ workspaceId: { in: wsIds } });
      if (coIds.length) conditions.push({ workspace: { companyId: { in: coIds } } });
      if (conditions.length === 1) {
        Object.assign(where, conditions[0]);
      } else if (conditions.length > 1) {
        where.OR = conditions;
      }
    } else if (workspaceId) {
      where.workspaceId = workspaceId;
    } else if (companyId) {
      where.workspace = { ...where.workspace, companyId };
    }

    const queryOptions: any = { where, orderBy };
    if (take !== undefined && take !== null) {
      queryOptions.take = Math.max(take, 1);
    }

    try {
      return await this.prisma.log.findMany(queryOptions);
    } catch (err) {
      this.logger.error(`Prisma query failed: ${err}. Query: ${JSON.stringify(queryJson)}`);
      const fallbackWhere: any = {};

      // apply mention scoping even in fallback
      if (mentions?.length) {
        const wsIds = mentions.filter((m) => m.type === 'workspace').map((m) => m.id);
        const coIds = mentions.filter((m) => m.type === 'company').map((m) => m.id);
        const conditions: any[] = [];
        if (wsIds.length) conditions.push({ workspaceId: { in: wsIds } });
        if (coIds.length) conditions.push({ workspace: { companyId: { in: coIds } } });
        if (conditions.length === 1) Object.assign(fallbackWhere, conditions[0]);
        else if (conditions.length > 1) fallbackWhere.OR = conditions;
      } else if (workspaceId) {
        fallbackWhere.workspaceId = workspaceId;
      } else if (companyId) {
        fallbackWhere.workspace = { companyId };
      }

      return this.prisma.log.findMany({
        where: fallbackWhere,
        orderBy: { timestamp: 'desc' },
        take: 200,
      });
    }
  }

  // ── Log context builder ───────────────────────────────────

  private buildLogContext(logs: any[]): string {
    const total = logs.length;
    if (total === 0) return 'No logs matched the query.';

    const bySeverity: Record<string, number> = {};
    const byEventType: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    const byVendor: Record<string, number> = {};
    const byProtocol: Record<string, number> = {};
    const srcIpCounts: Record<string, number> = {};
    const dstIpCounts: Record<string, number> = {};
    let minTs = Infinity;
    let maxTs = -Infinity;

    for (const l of logs) {
      bySeverity[l.severity] = (bySeverity[l.severity] || 0) + 1;
      byEventType[l.eventType] = (byEventType[l.eventType] || 0) + 1;
      if (l.action) byAction[l.action] = (byAction[l.action] || 0) + 1;
      byVendor[l.vendor] = (byVendor[l.vendor] || 0) + 1;
      if (l.protocol) byProtocol[l.protocol] = (byProtocol[l.protocol] || 0) + 1;
      if (l.sourceIp) srcIpCounts[l.sourceIp] = (srcIpCounts[l.sourceIp] || 0) + 1;
      if (l.destinationIp) dstIpCounts[l.destinationIp] = (dstIpCounts[l.destinationIp] || 0) + 1;
      if (l.timestamp < minTs) minTs = l.timestamp;
      if (l.timestamp > maxTs) maxTs = l.timestamp;
    }

    const topN = (map: Record<string, number>, n: number) =>
      Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n)
        .map(([k, v]) => `${k}: ${v}`).join(', ');

    const parts = [
      `Total logs retrieved: ${total}`,
      `Time range: ${new Date(minTs * 1000).toISOString()} to ${new Date(maxTs * 1000).toISOString()}`,
      `Severity breakdown: ${topN(bySeverity, 10)}`,
      `Event types: ${topN(byEventType, 10)}`,
      `Actions: ${topN(byAction, 10)}`,
      `Vendors: ${topN(byVendor, 10)}`,
      Object.keys(byProtocol).length > 0 ? `Protocols: ${topN(byProtocol, 10)}` : null,
      `Top source IPs: ${topN(srcIpCounts, 15)}`,
      `Top destination IPs: ${topN(dstIpCounts, 15)}`,
    ].filter(Boolean);

    const sampleLogs = total <= 50
      ? logs
      : [...logs.slice(0, 30), ...logs.slice(-10)];

    const sample = sampleLogs.map((l) => ({
      time: new Date(l.timestamp * 1000).toISOString(),
      severity: l.severity,
      vendor: l.vendor,
      event: l.eventType,
      action: l.action,
      app: l.application,
      proto: l.protocol,
      src: l.sourceIp ? `${l.sourceIp}:${l.sourcePort || ''}` : null,
      dst: l.destinationIp ? `${l.destinationIp}:${l.destinationPort || ''}` : null,
      policy: l.policy,
    }));

    parts.push(`\nSample logs (${sampleLogs.length} of ${total}):\n${JSON.stringify(sample, null, 1)}`);

    return parts.join('\n');
  }

  // ── Answer generation ─────────────────────────────────────

  private async generateAnswer(message: string, logs: any[], history?: MessageDto[], usageCtx?: any): Promise<string> {
    const logContext = this.buildLogContext(logs);

    // fetch admin-defined analysis rules
    const analysisRules = await this.prisma.analysisRule.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    let rulesSection = '';
    if (analysisRules.length > 0) {
      const ruleLines = analysisRules.map((r: any) => `- [${r.category}] ${r.content}`).join('\n');
      rulesSection = `\n\nANALYSIS GUIDELINES (defined by the SOC team — use these as additional context when evaluating logs, but apply your own judgment too):\n${ruleLines}`;
    }

    const systemPrompt = `You are Lurka, a SOC (Security Operations Center) AI analyst assistant.
You help security analysts investigate logs, identify threats, and understand network activity.

RULES:
- Answer ONLY the user's question directly. Do not volunteer extra information, statistics, or analysis they didn't ask for.
- The only exception: if you spot something genuinely critical or alarming in the data (e.g. active breach, suspicious exfiltration pattern), briefly mention it.
- Be concise and professional. No fluff, no filler, no "here's a summary" preambles.
- Reference specific data from the logs (IPs, timestamps, counts, patterns) when relevant to the question.
- When presenting timestamps or dates to the user, always show them in Europe/Athens (Greece) timezone in a natural human-readable format (e.g. "March 10 at 14:35", "yesterday at 09:12", "last Tuesday"). Never show raw Unix timestamps or UTC ISO strings.
- If the logs show something suspicious and the user asked about it, highlight it clearly.
- If the logs look normal, say so briefly. Don't invent threats.
- Use plain text. No markdown headers. Keep paragraphs short.
- When mentioning counts, be precise based on the data provided.
- You have aggregated stats and a sample of the ${logs.length} logs retrieved. Use both to answer.
${logs.length === 0 ? '- No logs matched the query. Let the user know and suggest refining their question.' : ''}${rulesSection}`;

    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (history?.length) {
      for (const msg of history.slice(-6)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    const userContent = logs.length > 0
      ? `${message}\n\n--- LOG DATA ---\n${logContext}`
      : message;

    messages.push({ role: 'user', content: userContent });

    const result = await this.callLlm(messages);
    if (usageCtx) this.recordUsage(result, 'answer', usageCtx);
    return result.content;
  }

  // ── LLM caller ────────────────────────────────────────────

  private async callLlm(messages: LlmMessage[]): Promise<LlmResult> {
    const { baseUrl, model, apiKey } = getOpenAiConfig();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const usage = data.usage || {};
    return {
      content: data.choices?.[0]?.message?.content || 'No response from model.',
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    };
  }

  private async recordUsage(
    result: LlmResult,
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
