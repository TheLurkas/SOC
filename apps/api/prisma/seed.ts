import 'dotenv/config';
import { auth } from '../src/auth/auth';

async function main() {
  const res = await auth.api.signUpEmail({
    body: {
      name: 'Admin',
      email: 'admin@lurkas.com',
      password: 'admin123',
    },
  });

  if (res?.user) {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.user.update({
      where: { id: res.user.id },
      data: { role: 'admin' },
    });
    await prisma.$disconnect();
    console.log('Default admin user created: admin@lurkas.com / admin123');
  } else {
    console.log('Admin user may already exist');
  }
}

main().catch(console.error);
