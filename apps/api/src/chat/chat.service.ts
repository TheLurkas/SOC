import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ChatRequestDto, ChatResponseDto, MessageDto } from '@soc/shared';

const CHUTES_BASE_URL = process.env.CHUTES_BASE_URL || 'https://llm.chutes.ai/v1';
const CHUTES_MODEL = process.env.CHUTES_MODEL || 'Qwen/Qwen2.5-72B-Instruct';
const CHUTES_API_KEY = process.env.CHUTES_API_KEY || '';

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

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly prisma: PrismaService) {}

  async chat(dto: ChatRequestDto): Promise<ChatResponseDto> {
    const { message, companyId, workspaceId, history } = dto;

    const queryJson = await this.generateQuery(message, companyId, workspaceId, history);
    const logs = await this.executePrismaQuery(queryJson, companyId, workspaceId);
    const reply = await this.generateAnswer(message, logs, history);

    return { reply, logsUsed: logs.length };
  }

  private async generateQuery(
    message: string,
    companyId?: string,
    workspaceId?: string,
    history?: MessageDto[],
  ): Promise<any> {
    const contextParts: string[] = [];
    if (workspaceId) contextParts.push(`The user is viewing workspace ID: "${workspaceId}"`);
    else if (companyId) contextParts.push(`The user is viewing company ID: "${companyId}". Query logs across ALL workspaces belonging to this company.`);
    else contextParts.push('No specific workspace/company selected. Query across all logs.');

    const systemPrompt = `You are a database query assistant for a SOC (Security Operations Center) platform.
Given a user's question about security logs, generate a Prisma "where" clause (as JSON) and optional ordering/limit to retrieve the relevant logs.

${LOG_SCHEMA}

RULES:
- Return ONLY valid JSON. No markdown, no explanation, no code fences.
- The JSON must have this shape: { "where": {}, "orderBy": {}, "take": number }
- "where" is a Prisma where clause for the Log model.
- "orderBy" defaults to { "timestamp": "desc" } if not specified.
- "take" is optional. Omit it to retrieve ALL matching logs. Only set it if the user explicitly asks for a specific number (e.g. "show me the last 50").
- ${contextParts.join(' ')}
- ${workspaceId ? `Always include workspaceId: "${workspaceId}" in the where clause.` : ''}
- ${companyId && !workspaceId ? `To filter by company, use: workspace: { companyId: "${companyId}" }` : ''}
- For time-based queries, "timestamp" is Unix epoch (seconds). Current time is approximately ${Math.floor(Date.now() / 1000)}.
- Use Prisma operators: equals, not, in, notIn, lt, lte, gt, gte, contains (for string search), mode: "insensitive" for case-insensitive.
- For "latest" or "recent" queries without a specific count, just use orderBy desc without a take limit.
- For severity filtering, valid values are: unknown, low, medium, high, critical (lowercase).
- For string matching on fields like eventType, vendor, action, application — use contains with mode: "insensitive" so casing doesn't matter.`;

    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (history?.length) {
      const recent = history.slice(-6);
      for (const msg of recent) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: message });

    const raw = await this.callLlm(messages);

    try {
      const cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      this.logger.warn(`LLM returned unparseable query, falling back to default. Raw: ${raw}`);
      const fallback: any = { where: {}, orderBy: { timestamp: 'desc' } };
      if (workspaceId) fallback.where.workspaceId = workspaceId;
      if (companyId && !workspaceId) fallback.where.workspace = { companyId };
      return fallback;
    }
  }

  private async executePrismaQuery(queryJson: any, companyId?: string, workspaceId?: string) {
    const { where = {}, orderBy = { timestamp: 'desc' }, take } = queryJson;

    if (workspaceId) {
      where.workspaceId = workspaceId;
    } else if (companyId) {
      where.workspace = { ...where.workspace, companyId };
    }

    const queryOptions: any = { where, orderBy };
    // only limit if the LLM explicitly set a take
    if (take !== undefined && take !== null) {
      queryOptions.take = Math.max(take, 1);
    }

    try {
      return await this.prisma.log.findMany(queryOptions);
    } catch (err) {
      this.logger.error(`Prisma query failed: ${err}. Query: ${JSON.stringify(queryJson)}`);
      const fallbackWhere: any = {};
      if (workspaceId) fallbackWhere.workspaceId = workspaceId;
      else if (companyId) fallbackWhere.workspace = { companyId };

      return this.prisma.log.findMany({
        where: fallbackWhere,
        orderBy: { timestamp: 'desc' },
        take: 200,
      });
    }
  }

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

    // include a sample of actual log rows (first 30 + last 10 for variety)
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

  private async generateAnswer(message: string, logs: any[], history?: MessageDto[]): Promise<string> {
    const logContext = this.buildLogContext(logs);

    const systemPrompt = `You are Lurka, a SOC (Security Operations Center) AI analyst assistant.
You help security analysts investigate logs, identify threats, and understand network activity.

RULES:
- Be concise and professional. No fluff.
- Reference specific data from the logs (IPs, timestamps, counts, patterns).
- If the logs show something suspicious, highlight it clearly.
- If the logs look normal, say so. Don't invent threats.
- Use plain text. No markdown headers. Keep paragraphs short.
- When mentioning counts, be precise based on the data provided.
- You have aggregated stats and a sample of the ${logs.length} logs retrieved. Use both to answer.
${logs.length === 0 ? '- No logs matched the query. Let the user know and suggest refining their question.' : ''}`;

    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (history?.length) {
      const recent = history.slice(-6);
      for (const msg of recent) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    const userContent = logs.length > 0
      ? `${message}\n\n--- LOG DATA ---\n${logContext}`
      : message;

    messages.push({ role: 'user', content: userContent });

    return this.callLlm(messages);
  }

  private async callLlm(messages: LlmMessage[]): Promise<string> {
    const res = await fetch(`${CHUTES_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CHUTES_API_KEY}`,
      },
      body: JSON.stringify({
        model: CHUTES_MODEL,
        messages,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'No response from model.';
  }
}
