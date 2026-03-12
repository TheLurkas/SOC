import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CreateAnalysisRuleDto, UpdateAnalysisRuleDto } from '@soc/shared';

const ruleInclude = {
  createdBy: { select: { id: true, name: true } },
};

@Controller('rules')
@UseGuards(AuthGuard)
export class RulesController {
  constructor(private readonly prisma: PrismaService) {}

  // any authenticated user can see rules
  @Get()
  async list() {
    const rules = await this.prisma.analysisRule.findMany({
      include: ruleInclude,
      orderBy: { createdAt: 'desc' },
    });
    return { data: rules };
  }

  @Post()
  @UseGuards(AdminGuard)
  async create(
    @Body() body: CreateAnalysisRuleDto,
    @CurrentUser() currentUser: any,
  ) {
    if (!body.title?.trim()) {
      throw new HttpException('Title is required', HttpStatus.BAD_REQUEST);
    }
    if (!body.content?.trim()) {
      throw new HttpException('Rule content is required', HttpStatus.BAD_REQUEST);
    }

    const valid = ['general', 'threat', 'compliance', 'network', 'custom'];
    const category = body.category || 'general';
    if (!valid.includes(category)) {
      throw new HttpException('Invalid category', HttpStatus.BAD_REQUEST);
    }

    const rule = await this.prisma.analysisRule.create({
      data: {
        title: body.title.trim(),
        content: body.content.trim(),
        category,
        createdById: currentUser.id,
      },
      include: ruleInclude,
    });

    return { data: rule };
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAnalysisRuleDto,
  ) {
    const existing = await this.prisma.analysisRule.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException('Rule not found', HttpStatus.NOT_FOUND);
    }

    const data: Record<string, any> = {};
    if (body.title !== undefined) data.title = body.title.trim();
    if (body.content !== undefined) data.content = body.content.trim();
    if (body.category !== undefined) data.category = body.category;
    if (body.enabled !== undefined) data.enabled = body.enabled;

    const rule = await this.prisma.analysisRule.update({
      where: { id },
      data,
      include: ruleInclude,
    });

    return { data: rule };
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  async delete(@Param('id') id: string) {
    const existing = await this.prisma.analysisRule.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException('Rule not found', HttpStatus.NOT_FOUND);
    }

    await this.prisma.analysisRule.delete({ where: { id } });
    return { data: { id } };
  }
}
