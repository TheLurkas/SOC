import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (!user) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (dbUser?.role !== 'admin') {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
