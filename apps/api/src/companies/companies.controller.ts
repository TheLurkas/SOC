import { Controller, Get, Post, Body, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';

@Controller('companies')
@UseGuards(AuthGuard)
export class CompaniesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const companies = await this.prisma.company.findMany({
      include: {
        _count: { select: { workspaces: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = companies.map((c) => ({
      id: c.id,
      name: c.name,
      contact: c.contact,
      workspaces: c._count.workspaces,
      createdAt: c.createdAt,
    }));

    return { data };
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        workspaces: {
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { workspaces: true } },
      },
    });

    if (!company) {
      throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
    }

    return {
      data: {
        id: company.id,
        name: company.name,
        contact: company.contact,
        createdAt: company.createdAt,
        workspaces: company.workspaces,
        workspaceCount: company._count.workspaces,
      },
    };
  }

  @Post()
  @UseGuards(AdminGuard)
  async create(@Body() body: { name: string; contact?: string }) {
    const { name, contact } = body;

    if (!name?.trim()) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }

    const company = await this.prisma.company.create({
      data: { name: name.trim(), contact: contact?.trim() || null },
    });

    return { data: company };
  }
}
