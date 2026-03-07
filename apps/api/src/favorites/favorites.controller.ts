import { Controller, Get, Post, Delete, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('favorites')
@UseGuards(AuthGuard)
export class FavoritesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getFavorites(@CurrentUser() user: any) {
    const favorites = await this.prisma.favoriteCompany.findMany({
      where: { userId: user.id },
      select: { companyId: true },
    });
    return { data: favorites.map((f) => f.companyId) };
  }

  @Post(':companyId')
  async addFavorite(@CurrentUser() user: any, @Param('companyId') companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
    }

    await this.prisma.favoriteCompany.upsert({
      where: { userId_companyId: { userId: user.id, companyId } },
      create: { userId: user.id, companyId },
      update: {},
    });

    return { data: { companyId } };
  }

  @Delete(':companyId')
  async removeFavorite(@CurrentUser() user: any, @Param('companyId') companyId: string) {
    await this.prisma.favoriteCompany.deleteMany({
      where: { userId: user.id, companyId },
    });

    return { data: { companyId } };
  }
}
