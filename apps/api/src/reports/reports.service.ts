import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { GenerateReportDto, SecurityReportDto } from '@soc/shared';

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

interface LlmResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface WorkspaceStats {
  workspaceName: string;
  total: number;
  severity: Record<string, number>;
  actions: Record<string, number>;
  eventTypes: Record<string, number>;
  topSourceIps: { ip: string; count: number }[];
  topDestIps: { ip: string; count: number }[];
  openAlerts: number;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateReport(userId: string, dto: GenerateReportDto): Promise<SecurityReportDto> {
    const { companies: companySelections } = dto;

    if (!companySelections?.length) {
      throw new HttpException('Select at least one company', HttpStatus.BAD_REQUEST);
    }

    // default period: last 7 days
    const periodTo = dto.periodTo ? new Date(dto.periodTo) : new Date();
    const periodFrom = dto.periodFrom
      ? new Date(dto.periodFrom)
      : new Date(periodTo.getTime() - 7 * 24 * 60 * 60 * 1000);

    const fromEpoch = Math.floor(periodFrom.getTime() / 1000);
    const toEpoch = Math.floor(periodTo.getTime() / 1000);

    // gather stats for all selected companies/workspaces
    const companyStats: { companyName: string; workspaces: WorkspaceStats[] }[] = [];

    for (const sel of companySelections) {
      const company = await this.prisma.company.findUnique({
        where: { id: sel.id },
        include: { workspaces: { select: { id: true, name: true } } },
      });
      if (!company) continue;

      const workspaces = sel.workspaceIds?.length
        ? company.workspaces.filter((w) => sel.workspaceIds!.includes(w.id))
        : company.workspaces;

      const wsStats: WorkspaceStats[] = [];

      for (const ws of workspaces) {
        const timeWhere = { workspaceId: ws.id, timestamp: { gte: fromEpoch, lte: toEpoch } };

        const [total, severityCounts, actionCounts, eventTypeCounts, topSrc, topDst, openAlerts] =
          await Promise.all([
            this.prisma.log.count({ where: timeWhere }),
            this.prisma.log.groupBy({ by: ['severity'], where: timeWhere, _count: { severity: true } }),
            this.prisma.log.groupBy({ by: ['action'], where: { ...timeWhere, action: { not: null } }, _count: { action: true } }),
            this.prisma.log.groupBy({ by: ['eventType'], where: timeWhere, _count: { eventType: true } }),
            this.prisma.log.groupBy({
              by: ['sourceIp'], where: { ...timeWhere, sourceIp: { not: null } },
              _count: { sourceIp: true }, orderBy: { _count: { sourceIp: 'desc' } }, take: 10,
            }),
            this.prisma.log.groupBy({
              by: ['destinationIp'], where: { ...timeWhere, destinationIp: { not: null } },
              _count: { destinationIp: true }, orderBy: { _count: { destinationIp: 'desc' } }, take: 10,
            }),
            this.prisma.alert.count({ where: { workspaceId: ws.id, status: 'open' } }),
          ]);

        const severity: Record<string, number> = {};
        for (const s of severityCounts) severity[s.severity] = s._count.severity;

        const actions: Record<string, number> = {};
        for (const a of actionCounts) actions[a.action!] = a._count.action;

        const eventTypes: Record<string, number> = {};
        for (const e of eventTypeCounts) eventTypes[e.eventType] = e._count.eventType;

        wsStats.push({
          workspaceName: ws.name,
          total,
          severity,
          actions,
          eventTypes,
          topSourceIps: topSrc.map((s) => ({ ip: s.sourceIp!, count: s._count.sourceIp })),
          topDestIps: topDst.map((d) => ({ ip: d.destinationIp!, count: d._count.destinationIp })),
          openAlerts,
        });
      }

      companyStats.push({ companyName: company.name, workspaces: wsStats });
    }

    // build the LLM prompt
    const statsContext = JSON.stringify(companyStats, null, 1);

    const systemPrompt = `You are a senior SOC analyst generating a formal security analysis report.
Given aggregated log statistics for selected companies and workspaces over a specific time period, produce a structured JSON report.

RULES:
- Return ONLY valid JSON matching the exact schema below. No markdown, no code fences, no extra text.
- Be specific and reference actual data (IPs, counts, severities) from the stats provided.
- Risk levels should be based on severity distribution, alert counts, and suspicious patterns.
- Recommendations should be actionable and specific to the data observed.
- topThreats should identify the most concerning patterns from the logs.
- If a workspace has zero logs, note it but don't flag it as a risk.

JSON SCHEMA:
{
  "title": "Security Analysis Report",
  "generatedAt": "${new Date().toISOString()}",
  "period": { "from": "${periodFrom.toISOString()}", "to": "${periodTo.toISOString()}" },
  "executiveSummary": "<2-4 sentences summarizing overall security posture>",
  "overallRiskLevel": "low|medium|high|critical",
  "companies": [
    {
      "name": "<company name>",
      "workspaces": [
        {
          "name": "<workspace name>",
          "totalLogs": <number>,
          "severityBreakdown": { "critical": <n>, "high": <n>, "medium": <n>, "low": <n> },
          "topThreats": ["<threat description>", ...],
          "topSourceIps": [{ "ip": "<ip>", "count": <n> }, ...],
          "topDestinationIps": [{ "ip": "<ip>", "count": <n> }, ...],
          "findings": "<paragraph describing key findings for this workspace>",
          "recommendations": ["<actionable recommendation>", ...]
        }
      ],
      "companySummary": "<paragraph summarizing the company's security posture>",
      "companyRiskLevel": "low|medium|high|critical"
    }
  ],
  "recommendations": ["<overall recommendation>", ...],
  "conclusion": "<final summary paragraph>"
}`;

    const result = await this.callLlm([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Generate a security report for the following data:\n\nPeriod: ${periodFrom.toISOString()} to ${periodTo.toISOString()}\n\n${statsContext}`,
      },
    ]);

    // record usage
    await this.recordUsage(result, 'report', {
      userId,
      companyId: companySelections[0]?.id || null,
    });

    // parse the response
    try {
      let cleaned = result.content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleaned = jsonMatch[0];
      return JSON.parse(cleaned) as SecurityReportDto;
    } catch {
      this.logger.error(`Failed to parse report JSON: ${result.content.slice(0, 200)}`);
      throw new HttpException('Failed to generate report — LLM returned invalid data', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private async callLlm(messages: { role: string; content: string }[]): Promise<LlmResult> {
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
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new HttpException(`LLM API error ${res.status}: ${text}`, HttpStatus.BAD_GATEWAY);
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

  private async recordUsage(
    result: LlmResult,
    purpose: string,
    ctx: { userId?: string; companyId?: string | null },
  ) {
    const model = getOpenAiConfig().model;
    const costUsd = calcCostUsd(model, result.promptTokens, result.completionTokens);
    try {
      await this.prisma.llmUsage.create({
        data: {
          userId: ctx.userId || null,
          companyId: ctx.companyId || null,
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
