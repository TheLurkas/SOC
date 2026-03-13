import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';

@Controller('usage')
@UseGuards(AuthGuard, AdminGuard)
export class UsageController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getUsage(
    @Query('companyId') companyId?: string,
    @Query('workspaceId') workspaceId?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const where: any = {};
    if (companyId) where.companyId = companyId;
    if (workspaceId) where.workspaceId = workspaceId;
    if (userId) where.userId = userId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [records, agg, byPurpose, byCompany, byUser] = await Promise.all([
      this.prisma.llmUsage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          company: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
        },
      }),
      this.prisma.llmUsage.aggregate({
        where,
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true, costUsd: true },
        _count: { _all: true },
      }),
      this.prisma.llmUsage.groupBy({
        by: ['purpose'],
        where,
        _sum: { totalTokens: true, costUsd: true },
        _count: { _all: true },
      }),
      this.prisma.llmUsage.groupBy({
        by: ['companyId'],
        where: { ...where, companyId: { not: null } },
        _sum: { totalTokens: true, costUsd: true },
        _count: { _all: true },
      }),
      this.prisma.llmUsage.groupBy({
        by: ['userId'],
        where: { ...where, userId: { not: null } },
        _sum: { totalTokens: true, costUsd: true },
        _count: { _all: true },
      }),
    ]);

    // resolve company names for groupBy
    const companyIds = byCompany.map((c) => c.companyId).filter(Boolean) as string[];
    const companies = companyIds.length > 0
      ? await this.prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
      : [];
    const companyMap = new Map(companies.map((c) => [c.id, c.name]));

    // resolve user names for groupBy
    const userIds = byUser.map((u) => u.userId).filter(Boolean) as string[];
    const users = userIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.name]));

    return {
      data: {
        totals: {
          calls: agg._count._all,
          promptTokens: agg._sum.promptTokens || 0,
          completionTokens: agg._sum.completionTokens || 0,
          totalTokens: agg._sum.totalTokens || 0,
          costUsd: Math.round((agg._sum.costUsd || 0) * 1_000_000) / 1_000_000,
        },
        byPurpose: byPurpose.map((p) => ({
          purpose: p.purpose,
          calls: p._count._all,
          tokens: p._sum.totalTokens || 0,
          costUsd: Math.round((p._sum.costUsd || 0) * 1_000_000) / 1_000_000,
        })),
        byCompany: byCompany.map((c) => ({
          companyId: c.companyId,
          companyName: companyMap.get(c.companyId!) || c.companyId,
          calls: c._count._all,
          tokens: c._sum.totalTokens || 0,
          costUsd: Math.round((c._sum.costUsd || 0) * 1_000_000) / 1_000_000,
        })),
        byUser: byUser.map((u) => ({
          userId: u.userId,
          userName: userMap.get(u.userId!) || u.userId,
          calls: u._count._all,
          tokens: u._sum.totalTokens || 0,
          costUsd: Math.round((u._sum.costUsd || 0) * 1_000_000) / 1_000_000,
        })),
        recent: records.map((r) => ({
          id: r.id,
          model: r.model,
          purpose: r.purpose,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
          totalTokens: r.totalTokens,
          costUsd: Math.round(r.costUsd * 1_000_000) / 1_000_000,
          companyName: r.company?.name || null,
          userName: r.user?.name || null,
          createdAt: r.createdAt.toISOString(),
        })),
      },
    };
  }
}
