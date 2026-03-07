import { Controller, Get, Post, Patch, Delete, Body, Param, Req, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { auth } from '../auth/auth';
import { hashPassword } from 'better-auth/crypto';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  private async requireAdmin(req: Request) {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.user.id } });
    if (user?.role !== 'admin') {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return session.user;
  }

  @Get()
  async listUsers(@Req() req: Request) {
    await this.requireAdmin(req);
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
  async createUser(@Req() req: Request, @Body() body: { name: string; email: string; password: string; role: string }) {
    await this.requireAdmin(req);

    const { name, email, password, role } = body;
    if (!name || !email || !password) {
      throw new HttpException('Missing required fields', HttpStatus.BAD_REQUEST);
    }
    if (role && !['admin', 'analyst'].includes(role)) {
      throw new HttpException('Invalid role', HttpStatus.BAD_REQUEST);
    }

    // Create user via Better Auth sign-up API
    const result = await auth.api.signUpEmail({
      body: { name, email, password },
    });

    if (!result?.user) {
      throw new HttpException('Failed to create user', HttpStatus.BAD_REQUEST);
    }

    // Update role if not default
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
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { name?: string; email?: string; role?: string; password?: string },
  ) {
    await this.requireAdmin(req);

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

    // Update password in the account table
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
  async deleteUser(@Req() req: Request, @Param('id') id: string) {
    const admin = await this.requireAdmin(req);

    if (admin.id === id) {
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
