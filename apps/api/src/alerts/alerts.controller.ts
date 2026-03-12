import { Controller, Get, Post, Patch, Delete, Param, Query, Body, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EventsGateway } from '../events/events.gateway';
import type { UpdateAlertDto, CreateAlertNoteDto } from '@soc/shared';

const alertInclude = {
  assignee: { select: { id: true, name: true, email: true } },
  workspace: {
    select: {
      id: true,
      name: true,
      company: { select: { id: true, name: true } },
    },
  },
};

const activityInclude = {
  user: { select: { id: true, name: true, email: true } },
  alert: {
    select: {
      id: true,
      title: true,
      severity: true,
      workspace: {
        select: {
          id: true,
          name: true,
          company: { select: { id: true, name: true } },
        },
      },
    },
  },
};

@Controller('alerts')
@UseGuards(AuthGuard)
export class AlertsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  // create a notification and push it via websocket
  private async notify(userId: string, type: string, title: string, body: string, alertId?: string) {
    const notification = await this.prisma.notification.create({
      data: { userId, type, title, body, alertId },
    });
    this.events.emitNotification({
      userId,
      notification: {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        alertId: notification.alertId,
        read: notification.read,
        createdAt: notification.createdAt.toISOString(),
      },
    });
  }

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('unassigned') unassigned?: string,
    @Query('workspaceId') workspaceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const where: any = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (assigneeId) where.assigneeId = assigneeId;
    if (unassigned === 'true') where.assigneeId = null;
    if (workspaceId) where.workspaceId = workspaceId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const take = Math.min(parseInt(limit || '50', 10), 200);
    const skip = (Math.max(parseInt(page || '1', 10), 1) - 1) * take;

    const [alerts, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        include: alertInclude,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.alert.count({ where }),
    ]);

    return {
      data: alerts,
      meta: {
        total,
        page: Math.floor(skip / take) + 1,
        limit: take,
        pages: Math.ceil(total / take),
      },
    };
  }

  @Get('stats')
  async stats() {
    const [total, statusCounts, severityCounts] = await Promise.all([
      this.prisma.alert.count(),
      this.prisma.alert.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      this.prisma.alert.groupBy({
        by: ['severity'],
        _count: { severity: true },
      }),
    ]);

    const statusMap: Record<string, number> = {};
    for (const s of statusCounts) {
      statusMap[s.status] = s._count.status;
    }

    return {
      data: {
        total,
        open: statusMap['open'] || 0,
        acknowledged: statusMap['acknowledged'] || 0,
        investigating: statusMap['investigating'] || 0,
        resolved: statusMap['resolved'] || 0,
        bySeverity: severityCounts.map((s) => ({ name: s.severity, value: s._count.severity })),
      },
    };
  }

  @Get('activity')
  @UseGuards(AdminGuard)
  async activity(
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const where: any = {};
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const take = Math.min(parseInt(limit || '50', 10), 200);
    const skip = (Math.max(parseInt(page || '1', 10), 1) - 1) * take;

    const [activities, total] = await Promise.all([
      this.prisma.alertActivity.findMany({
        where,
        include: activityInclude,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.alertActivity.count({ where }),
    ]);

    return {
      data: activities,
      meta: {
        total,
        page: Math.floor(skip / take) + 1,
        limit: take,
        pages: Math.ceil(total / take),
      },
    };
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const alert = await this.prisma.alert.findUnique({
      where: { id },
      include: alertInclude,
    });
    if (!alert) {
      throw new HttpException('Alert not found', HttpStatus.NOT_FOUND);
    }
    return { data: alert };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAlertDto,
    @CurrentUser() currentUser: any,
  ) {
    const existing = await this.prisma.alert.findUnique({
      where: { id },
      include: { assignee: { select: { name: true } } },
    });
    if (!existing) {
      throw new HttpException('Alert not found', HttpStatus.NOT_FOUND);
    }

    const data: Record<string, any> = {};
    const activities: { action: string; detail: string }[] = [];

    if (body.status !== undefined) {
      const valid = ['open', 'acknowledged', 'investigating', 'resolved'];
      if (!valid.includes(body.status)) {
        throw new HttpException('Invalid status', HttpStatus.BAD_REQUEST);
      }
      data.status = body.status;
      activities.push({
        action: 'status_changed',
        detail: `${existing.status} → ${body.status}`,
      });
    }

    if (body.assigneeId !== undefined) {
      if (body.assigneeId === null) {
        data.assigneeId = null;
        activities.push({
          action: 'unassigned',
          detail: existing.assignee?.name || 'unknown',
        });
      } else {
        const user = await this.prisma.user.findUnique({ where: { id: body.assigneeId } });
        if (!user) {
          throw new HttpException('Assignee not found', HttpStatus.NOT_FOUND);
        }
        data.assigneeId = body.assigneeId;
        activities.push({
          action: 'assigned',
          detail: user.name,
        });
      }
    }

    if (Object.keys(data).length === 0) {
      throw new HttpException('No fields to update', HttpStatus.BAD_REQUEST);
    }

    const [alert] = await Promise.all([
      this.prisma.alert.update({
        where: { id },
        data,
        include: alertInclude,
      }),
      // record all activities
      ...activities.map((a) =>
        this.prisma.alertActivity.create({
          data: {
            alertId: id,
            userId: currentUser.id,
            action: a.action,
            detail: a.detail,
          },
        }),
      ),
    ]);

    this.events.emitAlertUpdated({ alertId: id, workspaceId: existing.workspaceId });

    // send notifications
    for (const a of activities) {
      if (a.action === 'assigned' && body.assigneeId && body.assigneeId !== currentUser.id) {
        await this.notify(
          body.assigneeId,
          'assigned',
          `Alert assigned to you`,
          `"${existing.title}" was assigned to you by ${currentUser.name}`,
          id,
        );
      }
      if (a.action === 'unassigned' && existing.assigneeId && existing.assigneeId !== currentUser.id) {
        await this.notify(
          existing.assigneeId,
          'unassigned',
          `Alert unassigned`,
          `"${existing.title}" was unassigned from you by ${currentUser.name}`,
          id,
        );
      }
      if (a.action === 'status_changed' && existing.assigneeId && existing.assigneeId !== currentUser.id) {
        await this.notify(
          existing.assigneeId,
          'status_changed',
          `Alert status changed`,
          `"${existing.title}": ${a.detail}`,
          id,
        );
      }
    }

    return { data: alert };
  }

  @Get(':id/notes')
  async listNotes(@Param('id') id: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) {
      throw new HttpException('Alert not found', HttpStatus.NOT_FOUND);
    }

    const notes = await this.prisma.alertNote.findMany({
      where: { alertId: id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return { data: notes };
  }

  @Post(':id/notes')
  async addNote(
    @Param('id') id: string,
    @Body() body: CreateAlertNoteDto,
    @CurrentUser() currentUser: any,
  ) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) {
      throw new HttpException('Alert not found', HttpStatus.NOT_FOUND);
    }

    if (!body.content?.trim()) {
      throw new HttpException('Note content is required', HttpStatus.BAD_REQUEST);
    }

    const note = await this.prisma.alertNote.create({
      data: {
        alertId: id,
        userId: currentUser.id,
        content: body.content.trim(),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    // also record as activity
    await this.prisma.alertActivity.create({
      data: {
        alertId: id,
        userId: currentUser.id,
        action: 'note_added',
        detail: body.content.trim().slice(0, 100),
      },
    });

    // notify the assignee if someone else left a note on their alert
    if (alert.assigneeId && alert.assigneeId !== currentUser.id) {
      await this.notify(
        alert.assigneeId,
        'note_added',
        `New note on your alert`,
        `${currentUser.name} commented on "${alert.title}": ${body.content.trim().slice(0, 80)}`,
        id,
      );
    }

    return { data: note };
  }

  @Patch(':id/notes/:noteId')
  async updateNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body() body: CreateAlertNoteDto,
    @CurrentUser() currentUser: any,
  ) {
    const note = await this.prisma.alertNote.findUnique({ where: { id: noteId } });
    if (!note || note.alertId !== id) {
      throw new HttpException('Note not found', HttpStatus.NOT_FOUND);
    }
    // only the author or an admin can edit
    if (note.userId !== currentUser.id && currentUser.role !== 'admin') {
      throw new HttpException('Not authorized', HttpStatus.FORBIDDEN);
    }
    if (!body.content?.trim()) {
      throw new HttpException('Note content is required', HttpStatus.BAD_REQUEST);
    }

    const updated = await this.prisma.alertNote.update({
      where: { id: noteId },
      data: { content: body.content.trim() },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return { data: updated };
  }

  @Delete(':id/notes/:noteId')
  async deleteNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @CurrentUser() currentUser: any,
  ) {
    const note = await this.prisma.alertNote.findUnique({ where: { id: noteId } });
    if (!note || note.alertId !== id) {
      throw new HttpException('Note not found', HttpStatus.NOT_FOUND);
    }
    if (note.userId !== currentUser.id && currentUser.role !== 'admin') {
      throw new HttpException('Not authorized', HttpStatus.FORBIDDEN);
    }

    await this.prisma.alertNote.delete({ where: { id: noteId } });

    return { data: { id: noteId } };
  }
}
