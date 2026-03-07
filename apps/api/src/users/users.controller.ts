import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { hashPassword } from 'better-auth/crypto';
import { auth } from '../auth/auth';

@Controller('users')
@UseGuards(AuthGuard, AdminGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listUsers() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: users };
  }

  @Post()
  async createUser(@Body() body: { name: string; email: string; password: string; role: string }) {
    const { name, email, password, role } = body;
    if (!name || !email || !password) {
      throw new HttpException('Missing required fields', HttpStatus.BAD_REQUEST);
    }
    if (role && !['admin', 'analyst'].includes(role)) {
      throw new HttpException('Invalid role', HttpStatus.BAD_REQUEST);
    }

    const result = await auth.api.signUpEmail({
      body: { name, email, password },
    });

    if (!result?.user) {
      throw new HttpException('Failed to create user', HttpStatus.BAD_REQUEST);
    }

    if (role && role !== 'analyst') {
      await this.prisma.user.update({
        where: { id: result.user.id },
        data: { role },
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: result.user.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    return { data: user };
  }

  @Patch(':id')
  async updateUser(
    @Param('id') id: string,
    @Body() body: { name?: string; email?: string; role?: string; password?: string },
  ) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const data: Record<string, string> = {};
    if (body.name?.trim()) data.name = body.name.trim();
    if (body.email?.trim()) data.email = body.email.trim();
    if (body.role) {
      if (!['admin', 'analyst'].includes(body.role)) {
        throw new HttpException('Invalid role', HttpStatus.BAD_REQUEST);
      }
      data.role = body.role;
    }

    if (body.password?.trim()) {
      if (body.password.trim().length < 8) {
        throw new HttpException('Password must be at least 8 characters', HttpStatus.BAD_REQUEST);
      }
      const hashed = await hashPassword(body.password.trim());
      await this.prisma.account.updateMany({
        where: { userId: id, providerId: 'credential' },
        data: { password: hashed },
      });
    }

    if (Object.keys(data).length === 0 && !body.password?.trim()) {
      throw new HttpException('No fields to update', HttpStatus.BAD_REQUEST);
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id }, data });
    }

    const result = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    return { data: result };
  }

  @Delete(':id')
  async deleteUser(@CurrentUser() currentUser: any, @Param('id') id: string) {
    if (currentUser.id === id) {
      throw new HttpException('Cannot delete yourself', HttpStatus.BAD_REQUEST);
    }

    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    await this.prisma.user.delete({ where: { id } });
    return { data: { id } };
  }
}
