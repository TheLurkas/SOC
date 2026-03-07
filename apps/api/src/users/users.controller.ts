import { Controller, Get, Post, Body, Req, Res, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { auth } from '../auth/auth';

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
}
