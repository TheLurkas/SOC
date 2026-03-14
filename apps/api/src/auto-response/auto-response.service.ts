import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';

interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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

function calcCostUsd(model: string, prompt: number, completion: number): number {
  const p = MODEL_PRICING[model] || MODEL_PRICING['gpt-5.1'];
  return (prompt * p.input + completion * p.output) / 1_000_000;
}

@Injectable()
export class AutoResponseService {
  private readonly logger = new Logger(AutoResponseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  // Called fire-and-forget from AnalysisService after alert creation
  async generate(alertId: string, workspaceId: string): Promise<void> {
    try {
      await this._generate(alertId, workspaceId);
    } catch (err) {
      this.logger.error(`Auto-response generation failed for alert ${alertId}: ${err}`);
    }
  }

  private async _generate(alertId: string, workspaceId: string): Promise<void> {
    this.logger.log(`Auto-response triggered for alert ${alertId} in workspace ${workspaceId}`);

    const { apiKey } = getOpenAiConfig();
    if (!apiKey) {
      this.logger.warn('No OPENAI_API_KEY set — skipping auto-response');
      return;
    }

    const [alert, workspace] = await Promise.all([
      this.prisma.alert.findUnique({
        where: { id: alertId },
        select: { id: true, title: true, description: true, severity: true, sourceIp: true, destinationIp: true },
      }),
      this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          id: true,
          companyId: true,
          autoResponseEnabled: true,
          deviceHost: true,
          devicePort: true,
          deviceUser: true,
          devicePassword: true,
          deviceDescription: true,
        },
      }),
    ]);

    if (!alert) {
      this.logger.warn(`Alert ${alertId} not found in DB — cannot generate auto-response`);
      return;
    }
    if (!workspace) {
      this.logger.warn(`Workspace ${workspaceId} not found in DB — cannot generate auto-response`);
      return;
    }

    this.logger.log(`Workspace config: autoResponseEnabled=${workspace.autoResponseEnabled}, deviceHost=${workspace.deviceHost || 'null'}, deviceUser=${workspace.deviceUser || 'null'}, deviceDescription=${workspace.deviceDescription || 'null'}`);

    const deviceDesc = workspace.deviceDescription || 'generic Linux server';

    const systemPrompt = `You are an automated SOC incident response system. Based on an alert, you generate specific CLI commands to run on the affected network device to contain or mitigate the threat.

You must respond with a JSON object in this exact format:
{
  "reasoning": "Brief explanation of your response strategy",
  "commands": [
    {
      "type": "block_ip | rate_limit | disable_user | isolate_host | custom",
      "target": "the IP, username, or host this command acts on",
      "command": "the exact CLI command(s) to run, multi-line if needed",
      "reasoning": "why this specific command"
    }
  ]
}

TARGET DEVICE: ${deviceDesc}
Generate commands using the correct CLI syntax for the device described above. Use the exact command format and syntax that this device supports.

CRITICAL RULES FOR COMMAND GENERATION:
- Every setting must be explicitly set in the command — NEVER rely on device defaults. For example, if blocking traffic you must explicitly set "action deny", not assume the device defaults to deny.
- Do NOT create duplicate commands that target the same IP/host/user. One address object and one policy per target is enough.
- For firewall block rules: always explicitly set action (deny/drop), source/destination interfaces, source/destination addresses, schedule, and service. Leave nothing to defaults.
- For FortiGate/FortiOS specifically:
  * Always include "set action deny" in firewall policies — the default is accept
  * Use "set srcintf any" and "set dstintf any" unless the device description specifies exact interfaces
  * Create exactly ONE address object and ONE deny policy per target — no duplicates
  * Include "set logtraffic all" to ensure blocked traffic is logged
  * FortiGate has TWO policy tables — you must understand the difference:
    - "config firewall policy" — controls FORWARDED traffic (traffic passing through the FortiGate between interfaces). Use this when blocking an IP from reaching hosts behind the FortiGate.
    - "config firewall local-in-policy" — controls traffic destined TO the FortiGate itself (SSH, HTTPS management, ping, SNMP, etc.). Use this when the alert shows an IP attacking or scanning the FortiGate's own management IP. Local-in policies use "set srcaddr", "set dstaddr" (use the FortiGate's own address or "all"), "set intf" (incoming interface or "any"), "set action deny", "set schedule always", "set service ALL".
    - The device's management IP is provided in the alert context as "Device Management IP". If the alert's destination IP matches the management IP, is on the same subnet, or is a broadcast/multicast address on that subnet, the attacker is targeting the FortiGate itself — create BOTH a local-in-policy AND a firewall policy to fully block the source.
    - If the destination is clearly a host behind the FortiGate (different subnet), a firewall policy alone is sufficient.
  * When using "edit 0" to create a new policy, FortiGate auto-assigns the next available ID. You cannot know the ID in advance, so do NOT include a "move" command — the policy will be evaluated in order.
- Only generate commands that are safe and reversible where possible
- Order commands by priority (most critical first)
- If the device type is unclear, default to Linux iptables commands
- Keep commands concise and precise — these will be executed directly via SSH
- Return ONLY valid JSON, no markdown`;

    const userMsg = `Alert: ${alert.title}
Severity: ${alert.severity}
Description: ${alert.description}
Source IP: ${alert.sourceIp || 'unknown'}
Destination IP: ${alert.destinationIp || 'unknown'}
Device Management IP: ${workspace.deviceHost || 'unknown'}`;

    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ];

    this.logger.log(`Calling LLM for auto-response (alert: "${alert.title}", severity: ${alert.severity}, device: ${deviceDesc})`);

    const { baseUrl, model } = getOpenAiConfig();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.1, response_format: { type: 'json_object' } }),
    });

    if (!res.ok) {
      throw new Error(`LLM API error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const usage = data.usage || {};
    const content = data.choices?.[0]?.message?.content || '{}';

    // record usage
    const costUsd = calcCostUsd(model, usage.prompt_tokens || 0, usage.completion_tokens || 0);
    await this.prisma.llmUsage.create({
      data: {
        companyId: workspace.companyId,
        workspaceId,
        model,
        purpose: 'auto_response',
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        costUsd,
      },
    }).catch((err) => this.logger.warn(`Failed to record usage: ${err}`));

    let parsed: { reasoning: string; commands: Array<{ type: string; target: string; command: string; reasoning: string }> };
    try {
      let cleaned = content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) cleaned = match[0];
      parsed = JSON.parse(cleaned);
    } catch {
      this.logger.warn(`Auto-response LLM returned unparseable JSON for alert ${alertId}`);
      return;
    }

    if (!parsed.commands?.length) {
      this.logger.warn(`LLM returned no commands for alert ${alertId}`);
      return;
    }

    this.logger.log(`LLM generated ${parsed.commands.length} command(s): ${parsed.commands.map((c) => `${c.type}→${c.target}`).join(', ')}`);

    // auto-execute if enabled and device is configured, else recommended
    const canExecute = workspace.autoResponseEnabled && !!workspace.deviceHost && !!workspace.deviceUser;
    const responseStatus = canExecute ? 'pending' : 'recommended';
    this.logger.log(`Execution mode: canExecute=${canExecute} (enabled=${workspace.autoResponseEnabled}, host=${!!workspace.deviceHost}, user=${!!workspace.deviceUser}) → status=${responseStatus}`);

    const autoResponse = await this.prisma.autoResponse.create({
      data: {
        alertId,
        workspaceId,
        vendor: deviceDesc,
        reasoning: parsed.reasoning || '',
        status: responseStatus,
        commands: {
          create: parsed.commands.map((cmd, idx) => ({
            type: cmd.type || 'custom',
            target: cmd.target || '',
            command: cmd.command || '',
            reasoning: cmd.reasoning || '',
            priority: idx,
            status: canExecute ? 'pending' : 'skipped',
          })),
        },
      },
    });

    this.events.emitAutoResponseUpdated(workspaceId, alertId);
    this.logger.log(`Auto-response created for alert ${alertId} (${responseStatus}, device: ${deviceDesc})`);

    // if no device configured but autoResponseEnabled, warn
    if (workspace.autoResponseEnabled && !workspace.deviceHost) {
      this.logger.warn(`Workspace ${workspaceId} has autoResponseEnabled but no device configured`);
    }
  }

  // Logger polls this endpoint to pick up pending commands
  async getPending(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { deviceHost: true, devicePort: true, deviceUser: true, devicePassword: true, autoResponseEnabled: true },
    });

    if (!workspace?.autoResponseEnabled || !workspace.deviceHost) return { commands: [], device: null };

    const commands = await this.prisma.autoResponseCommand.findMany({
      where: {
        status: 'pending',
        autoResponse: { workspaceId, status: { in: ['pending', 'executing'] } },
      },
      orderBy: { priority: 'asc' },
      include: { autoResponse: { select: { id: true, alertId: true } } },
    });

    return {
      device: {
        host: workspace.deviceHost,
        port: workspace.devicePort || 22,
        user: workspace.deviceUser,
        password: workspace.devicePassword,
      },
      commands: commands.map((c) => ({
        id: c.id,
        autoResponseId: c.autoResponse.id,
        alertId: c.autoResponse.alertId,
        type: c.type,
        target: c.target,
        command: c.command,
        priority: c.priority,
      })),
    };
  }

  // Logger calls this after executing (or failing) a command
  async updateCommand(commandId: string, status: string, output: string | null, retryCount?: number) {
    const command = await this.prisma.autoResponseCommand.update({
      where: { id: commandId },
      data: {
        status,
        output,
        retryCount: retryCount !== undefined ? retryCount : { increment: status === 'failed' ? 1 : 0 },
        executedAt: status !== 'pending' ? new Date() : undefined,
      },
      include: {
        autoResponse: {
          select: { id: true, alertId: true, workspaceId: true, commands: { select: { status: true } } },
        },
      },
    });

    const ar = command.autoResponse;

    // if failed and hit max retries, notify all users
    if (status === 'failed' && command.retryCount >= 3) {
      await this.notifyAllUsers(ar.alertId, ar.workspaceId, command.type, command.target);
    }

    // update parent AutoResponse status based on all commands
    const allStatuses = ar.commands.map((c) => c.status);
    // re-fetch to get fresh statuses after our update
    const freshCommands = await this.prisma.autoResponseCommand.findMany({
      where: { autoResponseId: ar.id },
      select: { status: true },
    });
    const freshStatuses = freshCommands.map((c) => c.status);

    let newArStatus: string;
    if (freshStatuses.every((s) => s === 'success')) {
      newArStatus = 'completed';
    } else if (freshStatuses.some((s) => s === 'running' || s === 'pending')) {
      newArStatus = 'executing';
    } else if (freshStatuses.every((s) => s === 'failed' || s === 'skipped')) {
      newArStatus = 'failed';
    } else {
      newArStatus = 'executing';
    }

    await this.prisma.autoResponse.update({
      where: { id: ar.id },
      data: { status: newArStatus },
    });

    this.events.emitAutoResponseUpdated(ar.workspaceId, ar.alertId);

    return command;
  }

  async getByAlert(alertId: string) {
    return this.prisma.autoResponse.findUnique({
      where: { alertId },
      include: { commands: { orderBy: { priority: 'asc' } } },
    });
  }

  private async notifyAllUsers(alertId: string, workspaceId: string, commandType: string, target: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, company: { select: { name: true } } },
    });

    const users = await this.prisma.user.findMany({ select: { id: true } });

    const wsLabel = workspace ? `${workspace.company.name} / ${workspace.name}` : workspaceId;

    await this.prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: 'auto_response_failed',
        title: 'Auto-response failed',
        body: `Command "${commandType}" on target "${target}" failed after 3 attempts in ${wsLabel}.`,
        alertId,
      })),
    });

    // push WS notification to each user
    for (const user of users) {
      const notif = await this.prisma.notification.findFirst({
        where: { userId: user.id, alertId, type: 'auto_response_failed' },
        orderBy: { createdAt: 'desc' },
      });
      if (notif) {
        this.events.emitNotification({
          userId: user.id,
          notification: {
            id: notif.id,
            type: notif.type,
            title: notif.title,
            body: notif.body,
            alertId: notif.alertId,
            read: notif.read,
            createdAt: notif.createdAt.toISOString(),
          },
        });
      }
    }
  }
}
