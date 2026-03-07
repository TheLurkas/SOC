import { Controller, Get, Post, Body, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';

@Controller('companies/:companyId/workspaces')
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Param('companyId') companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
    }

    const workspaces = await this.prisma.workspace.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });

    return { data: workspaces };
  }

  @Get(':id')
  async getById(@Param('companyId') companyId: string, @Param('id') id: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id, companyId },
      include: { company: { select: { id: true, name: true } } },
    });

    if (!workspace) {
      throw new HttpException('Workspace not found', HttpStatus.NOT_FOUND);
    }

    return { data: workspace };
  }

  @Post()
  @UseGuards(AdminGuard)
  async create(
    @Param('companyId') companyId: string,
    @Body() body: { name: string; description?: string },
  ) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
    }

    const { name, description } = body;
    if (!name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }

    const workspace = await this.prisma.workspace.create({
      data: {
        companyId,
        name: name.trim(),
        description: description?.trim() || null,
      },
    });

    return { data: workspace };
  }
}
