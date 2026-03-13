import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { EventsGateway } from '../events/events.gateway';
import type { IngestLogDto, UpdateLogDto } from '@soc/shared';

@Controller('logs')
export class LogsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  // no auth — called by external log agents
  @Post('ingest')
  async ingest(@Body() body: IngestLogDto | IngestLogDto[]) {
    const logs = Array.isArray(body) ? body : [body];

    if (logs.length === 0) {
      throw new HttpException('No logs provided', HttpStatus.BAD_REQUEST);
    }

    const workspaceIds = [...new Set(logs.map((l) => l.workspaceId))];
    const workspaces = await this.prisma.workspace.findMany({
      where: { id: { in: workspaceIds } },
      select: { id: true },
    });
    const validIds = new Set(workspaces.map((w) => w.id));

    const invalid = workspaceIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      throw new HttpException(`Invalid workspace IDs: ${invalid.join(', ')}`, HttpStatus.BAD_REQUEST);
    }

    const data = logs.map((l) => ({
      workspaceId: l.workspaceId,
      timestamp: l.timestamp,
      severity: l.severity || 'unknown',
      vendor: l.vendor,
      eventType: l.eventType,
      action: l.action || null,
      application: l.application || null,
      protocol: l.protocol || null,
      policy: l.policy || null,
      sourceIp: l.sourceIp || l.source?.ip || null,
      sourcePort: l.sourcePort ?? l.source?.port ?? null,
      destinationIp: l.destinationIp || l.destination?.ip || null,
      destinationPort: l.destinationPort ?? l.destination?.port ?? null,
      srcCountry: l.srcCountry || null,
      dstCountry: l.dstCountry || null,
      rawLog: l.rawLog,
    }));

    const result = await this.prisma.log.createMany({ data });

    for (const wsId of workspaceIds) {
      const count = data.filter((d) => d.workspaceId === wsId).length;
      this.events.emitLogsIngested({ workspaceId: wsId, count });
    }

    return { data: { count: result.count } };
  }

  @Get('workspace/:workspaceId/stats')
  @UseGuards(AuthGuard)
  async getStats(@Param('workspaceId') workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new HttpException('Workspace not found', HttpStatus.NOT_FOUND);
    }

    const [
      total,
      severityCounts,
      actionCounts,
      eventTypeCounts,
      vendorCounts,
      topSourceIps,
      topDestIps,
      volumeOverTime,
    ] = await Promise.all([
      this.prisma.log.count({ where: { workspaceId } }),

      this.prisma.log.groupBy({
        by: ['severity'],
        where: { workspaceId },
        _count: { severity: true },
      }),

      this.prisma.log.groupBy({
        by: ['action'],
        where: { workspaceId, action: { not: null } },
        _count: { action: true },
      }),

      this.prisma.log.groupBy({
        by: ['eventType'],
        where: { workspaceId },
        _count: { eventType: true },
      }),

      this.prisma.log.groupBy({
        by: ['vendor'],
        where: { workspaceId },
        _count: { vendor: true },
      }),

      this.prisma.log.groupBy({
        by: ['sourceIp'],
        where: { workspaceId, sourceIp: { not: null } },
        _count: { sourceIp: true },
        orderBy: { _count: { sourceIp: 'desc' } },
        take: 10,
      }),

      this.prisma.log.groupBy({
        by: ['destinationIp'],
        where: { workspaceId, destinationIp: { not: null } },
        _count: { destinationIp: true },
        orderBy: { _count: { destinationIp: 'desc' } },
        take: 10,
      }),

      this.prisma.log.findMany({
        where: { workspaceId },
        select: { timestamp: true },
        orderBy: { timestamp: 'asc' },
      }),
    ]);

    // bucket timestamps into ~12 slices for the chart
    const timeBuckets: { time: string; count: number }[] = [];
    if (volumeOverTime.length > 0) {
      const timestamps = volumeOverTime.map((l) => l.timestamp);
      const min = timestamps[0];
      const max = timestamps[timestamps.length - 1];
      const bucketSize = Math.max(Math.floor((max - min) / 12), 1);
      const buckets: Record<number, number> = {};

      for (const ts of timestamps) {
        const bucket = Math.floor((ts - min) / bucketSize);
        const bucketTs = min + bucket * bucketSize;
        buckets[bucketTs] = (buckets[bucketTs] || 0) + 1;
      }

      for (const [ts, count] of Object.entries(buckets)) {
        timeBuckets.push({
          time: new Date(Number(ts) * 1000).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
          count,
        });
      }
    }

    return {
      data: {
        total,
        severity: severityCounts.map((s) => ({ name: s.severity, value: s._count.severity })),
        actions: actionCounts.map((a) => ({ name: a.action!, value: a._count.action })),
        eventTypes: eventTypeCounts.map((e) => ({ name: e.eventType, value: e._count.eventType })),
        vendors: vendorCounts.map((v) => ({ name: v.vendor, value: v._count.vendor })),
        topSourceIps: topSourceIps.map((s) => ({ ip: s.sourceIp!, count: s._count.sourceIp })),
        topDestIps: topDestIps.map((d) => ({ ip: d.destinationIp!, count: d._count.destinationIp })),
        volume: timeBuckets,
      },
    };
  }

  @Get('company/:companyId/stats')
  @UseGuards(AuthGuard)
  async getCompanyStats(@Param('companyId') companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { workspaces: { select: { id: true } } },
    });
    if (!company) {
      throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
    }

    const wsIds = company.workspaces.map((w) => w.id);
    if (wsIds.length === 0) {
      return {
        data: {
          total: 0, severity: [], actions: [], eventTypes: [], vendors: [],
          topSourceIps: [], topDestIps: [], volume: [],
          openAlerts: 0, workspaceBreakdown: [],
        },
      };
    }

    const where = { workspaceId: { in: wsIds } };

    const [
      total, severityCounts, actionCounts, eventTypeCounts, vendorCounts,
      topSourceIps, topDestIps, volumeOverTime, openAlerts, wsLogCounts,
    ] = await Promise.all([
      this.prisma.log.count({ where }),
      this.prisma.log.groupBy({ by: ['severity'], where, _count: { severity: true } }),
      this.prisma.log.groupBy({ by: ['action'], where: { ...where, action: { not: null } }, _count: { action: true } }),
      this.prisma.log.groupBy({ by: ['eventType'], where, _count: { eventType: true } }),
      this.prisma.log.groupBy({ by: ['vendor'], where, _count: { vendor: true } }),
      this.prisma.log.groupBy({
        by: ['sourceIp'], where: { ...where, sourceIp: { not: null } },
        _count: { sourceIp: true }, orderBy: { _count: { sourceIp: 'desc' } }, take: 10,
      }),
      this.prisma.log.groupBy({
        by: ['destinationIp'], where: { ...where, destinationIp: { not: null } },
        _count: { destinationIp: true }, orderBy: { _count: { destinationIp: 'desc' } }, take: 10,
      }),
      this.prisma.log.findMany({ where, select: { timestamp: true }, orderBy: { timestamp: 'asc' } }),
      this.prisma.alert.count({ where: { workspace: { companyId }, status: 'open' } }),
      this.prisma.log.groupBy({
        by: ['workspaceId'], where, _count: { _all: true },
      }),
    ]);

    const timeBuckets: { time: string; count: number }[] = [];
    if (volumeOverTime.length > 0) {
      const timestamps = volumeOverTime.map((l) => l.timestamp);
      const min = timestamps[0];
      const max = timestamps[timestamps.length - 1];
      const bucketSize = Math.max(Math.floor((max - min) / 12), 1);
      const buckets: Record<number, number> = {};
      for (const ts of timestamps) {
        const bucket = Math.floor((ts - min) / bucketSize);
        const bucketTs = min + bucket * bucketSize;
        buckets[bucketTs] = (buckets[bucketTs] || 0) + 1;
      }
      for (const [ts, count] of Object.entries(buckets)) {
        timeBuckets.push({
          time: new Date(Number(ts) * 1000).toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit', hour12: false,
          }),
          count,
        });
      }
    }

    // map workspace IDs back to names
    const wsMap = new Map(company.workspaces.map((w) => [w.id, w.id]));
    const wsNames = await this.prisma.workspace.findMany({
      where: { id: { in: wsIds } }, select: { id: true, name: true },
    });
    for (const w of wsNames) wsMap.set(w.id, w.name);

    return {
      data: {
        total,
        severity: severityCounts.map((s) => ({ name: s.severity, value: s._count.severity })),
        actions: actionCounts.map((a) => ({ name: a.action!, value: a._count.action })),
        eventTypes: eventTypeCounts.map((e) => ({ name: e.eventType, value: e._count.eventType })),
        vendors: vendorCounts.map((v) => ({ name: v.vendor, value: v._count.vendor })),
        topSourceIps: topSourceIps.map((s) => ({ ip: s.sourceIp!, count: s._count.sourceIp })),
        topDestIps: topDestIps.map((d) => ({ ip: d.destinationIp!, count: d._count.destinationIp })),
        volume: timeBuckets,
        openAlerts,
        workspaceBreakdown: wsLogCounts.map((w) => ({
          name: wsMap.get(w.workspaceId) || w.workspaceId,
          value: w._count._all,
        })),
      },
    };
  }

  @Get('workspace/:workspaceId')
  @UseGuards(AuthGuard)
  async getByWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Query('severity') severity?: string,
    @Query('vendor') vendor?: string,
    @Query('eventType') eventType?: string,
    @Query('action') action?: string,
    @Query('sourceIp') sourceIp?: string,
    @Query('destinationIp') destinationIp?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new HttpException('Workspace not found', HttpStatus.NOT_FOUND);
    }

    const where: any = { workspaceId };

    if (severity) where.severity = severity;
    if (vendor) where.vendor = vendor;
    if (eventType) where.eventType = eventType;
    if (action) where.action = action;
    if (sourceIp) where.sourceIp = sourceIp;
    if (destinationIp) where.destinationIp = destinationIp;

    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = parseInt(from, 10);
      if (to) where.timestamp.lte = parseInt(to, 10);
    }

    if (search) {
      where.rawLog = { contains: search, mode: 'insensitive' };
    }

    const take = Math.min(parseInt(limit || '50', 10), 200);
    const skip = (Math.max(parseInt(page || '1', 10), 1) - 1) * take;

    const [logs, total] = await Promise.all([
      this.prisma.log.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take,
        skip,
      }),
      this.prisma.log.count({ where }),
    ]);

    return {
      data: logs,
      meta: {
        total,
        page: Math.floor(skip / take) + 1,
        limit: take,
        pages: Math.ceil(total / take),
      },
    };
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async getById(@Param('id') id: string) {
    const log = await this.prisma.log.findUnique({
      where: { id },
      include: { workspace: { select: { id: true, name: true, companyId: true } } },
    });

    if (!log) {
      throw new HttpException('Log not found', HttpStatus.NOT_FOUND);
    }

    return { data: log };
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AdminGuard)
  async update(
    @Param('id') id: string,
    @Body() body: UpdateLogDto,
  ) {
    const existing = await this.prisma.log.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException('Log not found', HttpStatus.NOT_FOUND);
    }

    const data: Record<string, any> = {};
    if (body.severity !== undefined) data.severity = body.severity;
    if (body.vendor !== undefined) data.vendor = body.vendor;
    if (body.eventType !== undefined) data.eventType = body.eventType;
    if (body.action !== undefined) data.action = body.action;
    if (body.application !== undefined) data.application = body.application;
    if (body.protocol !== undefined) data.protocol = body.protocol;
    if (body.policy !== undefined) data.policy = body.policy;

    if (Object.keys(data).length === 0) {
      throw new HttpException('No fields to update', HttpStatus.BAD_REQUEST);
    }

    const log = await this.prisma.log.update({ where: { id }, data });
    this.events.emitLogUpdated({ workspaceId: existing.workspaceId, logId: id });
    return { data: log };
  }

  @Delete(':id')
  @UseGuards(AuthGuard, AdminGuard)
  async delete(@Param('id') id: string) {
    const existing = await this.prisma.log.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException('Log not found', HttpStatus.NOT_FOUND);
    }

    await this.prisma.log.delete({ where: { id } });
    this.events.emitLogDeleted({ workspaceId: existing.workspaceId, logId: id });
    return { data: { id } };
  }

  @Delete('workspace/:workspaceId')
  @UseGuards(AuthGuard, AdminGuard)
  async deleteByWorkspace(@Param('workspaceId') workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new HttpException('Workspace not found', HttpStatus.NOT_FOUND);
    }

    const result = await this.prisma.log.deleteMany({ where: { workspaceId } });
    this.events.emitLogsCleared({ workspaceId, deleted: result.count });
    return { data: { deleted: result.count } };
  }
}
