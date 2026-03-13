import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('stats')
  async stats() {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twentyFourHoursAgo = Math.floor((now.getTime() - 24 * 60 * 60 * 1000) / 1000);

    const [totalLogs, logRows, alertRows, alertsByCompanyRaw] = await Promise.all([
      this.prisma.log.count(),

      // logs from last 24h for volume chart
      this.prisma.log.findMany({
        where: { timestamp: { gte: twentyFourHoursAgo } },
        select: { timestamp: true },
        orderBy: { timestamp: 'asc' },
      }),

      // alerts from last 7 days for alerts chart
      this.prisma.alert.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { createdAt: true, severity: true },
      }),

      // alerts per company
      this.prisma.alert.groupBy({
        by: ['workspaceId'],
        _count: { _all: true },
      }),
    ]);

    // bucket logs into hourly slots over last 24h
    const logVolume: { hour: string; logs: number }[] = [];
    const hourBuckets: Record<string, number> = {};

    // initialize all 12 two-hour buckets
    for (let i = 0; i < 12; i++) {
      const bucketTime = new Date(now.getTime() - (11 - i) * 2 * 60 * 60 * 1000);
      const label = bucketTime.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      hourBuckets[label] = 0;
    }

    for (const row of logRows) {
      const logDate = new Date(row.timestamp * 1000);
      // snap to nearest 2-hour bucket
      const hoursAgo = (now.getTime() - logDate.getTime()) / (1000 * 60 * 60);
      const bucketIndex = 11 - Math.min(Math.floor(hoursAgo / 2), 11);
      const bucketTime = new Date(now.getTime() - (11 - bucketIndex) * 2 * 60 * 60 * 1000);
      const label = bucketTime.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      if (label in hourBuckets) {
        hourBuckets[label]++;
      }
    }

    for (const [hour, logs] of Object.entries(hourBuckets)) {
      logVolume.push({ hour, logs });
    }

    // bucket alerts into days over last 7 days, grouped by severity
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const alertsByDay: { day: string; critical: number; high: number; medium: number; low: number }[] = [];
    const dayBuckets: Record<string, { critical: number; high: number; medium: number; low: number }> = {};

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const label = dayLabels[d.getDay()];
      dayBuckets[label] = { critical: 0, high: 0, medium: 0, low: 0 };
    }

    for (const alert of alertRows) {
      const d = new Date(alert.createdAt);
      const label = dayLabels[d.getDay()];
      if (label in dayBuckets) {
        const sev = alert.severity as 'critical' | 'high' | 'medium' | 'low';
        if (sev in dayBuckets[label]) {
          dayBuckets[label][sev]++;
        }
      }
    }

    for (const [day, counts] of Object.entries(dayBuckets)) {
      alertsByDay.push({ day, ...counts });
    }

    // aggregate alerts per company
    const wsIds = alertsByCompanyRaw.map((r) => r.workspaceId);
    const workspaces = wsIds.length > 0
      ? await this.prisma.workspace.findMany({
          where: { id: { in: wsIds } },
          select: { id: true, companyId: true, company: { select: { name: true } } },
        })
      : [];
    const wsToCompany = new Map(workspaces.map((w) => [w.id, { id: w.companyId, name: w.company.name }]));

    const companyAlertMap = new Map<string, { name: string; count: number }>();
    for (const row of alertsByCompanyRaw) {
      const company = wsToCompany.get(row.workspaceId);
      if (!company) continue;
      const existing = companyAlertMap.get(company.id);
      if (existing) {
        existing.count += row._count._all;
      } else {
        companyAlertMap.set(company.id, { name: company.name, count: row._count._all });
      }
    }
    const alertsByCompany = [...companyAlertMap.values()]
      .sort((a, b) => b.count - a.count)
      .map((c) => ({ name: c.name, alerts: c.count }));

    return {
      data: {
        totalLogs,
        logVolume,
        alertsByDay,
        alertsByCompany,
      },
    };
  }
}
