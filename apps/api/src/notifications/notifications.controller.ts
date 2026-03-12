import { Controller, Get, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @CurrentUser() currentUser: any,
    @Query('unread') unread?: string,
  ) {
    const where: any = { userId: currentUser.id };
    if (unread === 'true') where.read = false;

    const [notifications, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.notification.count({
        where: { userId: currentUser.id, read: false },
      }),
    ]);

    return { data: notifications, meta: { unreadCount } };
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() currentUser: any) {
    const count = await this.prisma.notification.count({
      where: { userId: currentUser.id, read: false },
    });
    return { data: { count } };
  }

  @Patch(':id/read')
  async markRead(
    @Param('id') id: string,
    @CurrentUser() currentUser: any,
  ) {
    await this.prisma.notification.updateMany({
      where: { id, userId: currentUser.id },
      data: { read: true },
    });
    return { data: { id } };
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser() currentUser: any) {
    await this.prisma.notification.updateMany({
      where: { userId: currentUser.id, read: false },
      data: { read: true },
    });
    return { data: { success: true } };
  }
}
