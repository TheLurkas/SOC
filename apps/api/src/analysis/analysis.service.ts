import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { ReputationService } from '../reputation/reputation.service';
import { AutoResponseService } from '../auto-response/auto-response.service';

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

const getOpenAiConfig = () => ({
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.OPENAI_MODEL || 'gpt-5.1',
  apiKey: process.env.OPENAI_API_KEY || '',
});

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

const MAX_LOGS_PER_BATCH = 200;
const ANALYSIS_INTERVAL_MS = 30_000;

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
    private readonly reputation: ReputationService,
    private readonly autoResponse: AutoResponseService,
  ) {}

  @Interval(ANALYSIS_INTERVAL_MS)
  async analyzeNewLogs() {
    if (this.isRunning) return;
    if (!getOpenAiConfig().apiKey) return;

    this.isRunning = true;
    try {
      await this.runAnalysis();
    } catch (err) {
      this.logger.error(`Analysis cycle failed: ${err}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async runAnalysis() {
    // grab unanalyzed logs
    const logs = await this.prisma.log.findMany({
      where: { analyzed: false },
      orderBy: { createdAt: 'asc' },
      take: 1000,
      select: {
        id: true,
        workspaceId: true,
        timestamp: true,
        severity: true,
        eventType: true,
        action: true,
        sourceIp: true,
        sourcePort: true,
        destinationIp: true,
        destinationPort: true,
        protocol: true,
        application: true,
        srcCountry: true,
        dstCountry: true,
      },
    });

    if (logs.length === 0) return;

    // group by workspace
    const byWorkspace = new Map<string, typeof logs>();
    for (const log of logs) {
      const arr = byWorkspace.get(log.workspaceId) || [];
      arr.push(log);
      byWorkspace.set(log.workspaceId, arr);
    }

    // fetch enabled rules once
    const rules = await this.prisma.analysisRule.findMany({
      where: { enabled: true },
      select: { title: true, content: true, category: true },
    });

    if (rules.length === 0) {
      // no rules — mark all as analyzed and skip
      const logIds = logs.map((l) => l.id);
      await this.prisma.log.updateMany({
        where: { id: { in: logIds } },
        data: { analyzed: true },
      });
      this.logger.log(`Marked ${logIds.length} log(s) as analyzed (no rules enabled)`);
      return;
    }

    for (const [workspaceId, wsLogs] of byWorkspace) {
      // process in chunks of MAX_LOGS_PER_BATCH
      for (let i = 0; i < wsLogs.length; i += MAX_LOGS_PER_BATCH) {
        const batch = wsLogs.slice(i, i + MAX_LOGS_PER_BATCH);
        await this.analyzeBatch(workspaceId, batch, rules);
      }
    }
  }

  private async analyzeBatch(
    workspaceId: string,
    batch: Array<{
      id: string;
      workspaceId: string;
      timestamp: number;
      severity: string;
      eventType: string;
      action: string | null;
      sourceIp: string | null;
      sourcePort: number | null;
      destinationIp: string | null;
      destinationPort: number | null;
      protocol: string | null;
      application: string | null;
      srcCountry: string | null;
      dstCountry: string | null;
    }>,
    rules: Array<{ title: string; content: string; category: string }>,
  ) {
    const logIds = batch.map((l) => l.id);

    // fetch recent open alerts for dedup context
    const recentAlerts = await this.prisma.alert.findMany({
      where: { workspaceId, status: { in: ['open', 'acknowledged', 'investigating'] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { title: true, severity: true, description: true },
    });

    // fetch cached IP reputation for source IPs in this batch
    const uniqueSrcIps = [...new Set(batch.map((l) => l.sourceIp).filter(Boolean) as string[])];
    const reputations = await this.reputation.getCached(uniqueSrcIps);

    // find IPs already blocked by a completed auto-response in this workspace
    const blockedResponses = await this.prisma.autoResponse.findMany({
      where: {
        workspaceId,
        status: 'completed',
        alert: { sourceIp: { in: uniqueSrcIps } },
      },
      select: { alert: { select: { sourceIp: true } } },
    });
    const blockedIps = new Set(blockedResponses.map((r) => r.alert.sourceIp).filter(Boolean));

    // build compact log data (no rawLog to save tokens)
    const compactLogs = batch.map((l) => ({
      timestamp: l.timestamp,
      severity: l.severity,
      eventType: l.eventType,
      action: l.action,
      srcIp: l.sourceIp,
      srcPort: l.sourcePort,
      dstIp: l.destinationIp,
      dstPort: l.destinationPort,
      protocol: l.protocol,
      app: l.application,
      srcCountry: l.srcCountry,
      dstCountry: l.dstCountry,
      srcAbuseScore: l.sourceIp ? (reputations.get(l.sourceIp)?.abuseScore ?? null) : null,
    }));

    const rulesText = rules
      .map((r) => `- [${r.category}] ${r.title}: ${r.content}`)
      .join('\n');

    const existingAlertsText = recentAlerts.length > 0
      ? recentAlerts.map((a) => `- "${a.title}" (${a.severity}): ${a.description.slice(0, 100)}`).join('\n')
      : 'None';

    // build reputation summary for IPs with notable scores
    const repLines = uniqueSrcIps
      .map((ip) => reputations.get(ip))
      .filter((r): r is NonNullable<typeof r> => !!r && r.abuseScore > 0)
      .map((r) => `  ${r.ip}: score=${r.abuseScore}/100, isp="${r.isp || 'unknown'}", reports=${r.totalReports}${r.usageType ? `, type="${r.usageType}"` : ''}`)
      .join('\n');

    const repContext = repLines
      ? `\nIP REPUTATION (AbuseIPDB scores, 0-100 where higher = more malicious):\n${repLines}\n- Score ≥ 80: likely malicious — treat as high-confidence threat indicator\n- Score 25-79: suspicious — consider as supporting evidence\n`
      : '';

    const blockedIpsText = blockedIps.size > 0
      ? `\nALREADY BLOCKED IPs (auto-response commands have been successfully executed on the device for these IPs — do NOT generate new alerts for traffic from them):\n${[...blockedIps].join(', ')}\n`
      : '';

    const systemPrompt = `You are an automated SOC alert generator. You analyze firewall/network logs and decide whether any security alerts should be generated based on the analysis rules provided.

ANALYSIS RULES:
${rulesText}

EXISTING OPEN ALERTS (do NOT create duplicates of these):
${existingAlertsText}
${blockedIpsText}${repContext}
INSTRUCTIONS:
- Examine the logs below and apply the analysis rules.
- Only generate alerts when the evidence clearly warrants it. Do not over-alert.
- Do NOT generate alerts for IPs listed under "ALREADY BLOCKED IPs" — these have already been mitigated by the auto-response system. Logs from these IPs are expected residual traffic before the block fully takes effect.
- Each alert should represent a distinct security concern backed by multiple log entries when possible.
- If a source IP has an abuse score ≥ 80, treat it as a confirmed threat indicator and elevate alert severity accordingly.
- Return a JSON object with an "alerts" array. If no alerts are warranted, return {"alerts": []}.
- Each alert object must have exactly these fields:
  {
    "title": "Short descriptive title",
    "description": "Detailed explanation of what was detected and why it matters",
    "severity": "low|medium|high|critical",
    "sourceIp": "the primary source IP involved, or null",
    "destinationIp": "the primary destination IP involved, or null",
    "logCount": <number of logs that contributed to this alert>
  }
- Return ONLY valid JSON. No markdown, no explanation outside the JSON.`;

    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ workspace: workspaceId, logCount: batch.length, logs: compactLogs }) },
    ];

    let result: LlmResult;
    try {
      result = await this.callLlm(messages);
    } catch (err) {
      // LLM is down — don't mark as analyzed so they'll be retried
      this.logger.error(`LLM call failed for workspace ${workspaceId}: ${err}`);
      return;
    }

    // parse the response
    let alerts: Array<{
      title: string;
      description: string;
      severity: string;
      sourceIp: string | null;
      destinationIp: string | null;
      logCount: number;
    }> = [];

    try {
      let cleaned = result.content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleaned = jsonMatch[0];
      const parsed = JSON.parse(cleaned);
      alerts = parsed.alerts || [];
    } catch {
      this.logger.warn(`LLM returned unparseable JSON for workspace ${workspaceId}, marking logs as analyzed`);
    }

    // get workspace's companyId for usage tracking
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { companyId: true },
    });

    // create alerts and mark logs as analyzed in a transaction
    const createdAlertIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const alert of alerts) {
        const validSeverities = ['low', 'medium', 'high', 'critical'];
        const severity = validSeverities.includes(alert.severity) ? alert.severity : 'medium';

        const created = await tx.alert.create({
          data: {
            workspaceId,
            title: alert.title,
            description: alert.description,
            severity,
            sourceIp: alert.sourceIp || null,
            destinationIp: alert.destinationIp || null,
            logCount: alert.logCount || batch.length,
          },
        });

        createdAlertIds.push(created.id);
        this.events.emitAlertCreated({ alertId: created.id, workspaceId });
        this.logger.log(`Alert created: [${severity}] ${alert.title}`);
      }

      await tx.log.updateMany({
        where: { id: { in: logIds } },
        data: { analyzed: true },
      });
    });

    // trigger auto-response after transaction commits so the alert is visible
    for (const alertId of createdAlertIds) {
      void this.autoResponse.generate(alertId, workspaceId);
    }

    // record usage outside the transaction
    await this.recordUsage(result, workspaceId, workspace?.companyId || null);

    if (alerts.length > 0) {
      this.logger.log(`Workspace ${workspaceId}: ${alerts.length} alert(s) from ${batch.length} logs`);
    } else {
      this.logger.log(`Workspace ${workspaceId}: ${batch.length} logs analyzed, no alerts`);
    }
  }

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
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const usage = data.usage || {};
    return {
      content: data.choices?.[0]?.message?.content || '{"alerts":[]}',
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    };
  }

  private async recordUsage(result: LlmResult, workspaceId: string, companyId: string | null) {
    const model = getOpenAiConfig().model;
    const costUsd = calcCostUsd(model, result.promptTokens, result.completionTokens);
    try {
      await this.prisma.llmUsage.create({
        data: {
          userId: null,
          companyId,
          workspaceId,
          conversationId: null,
          model,
          purpose: 'alert_analysis',
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
