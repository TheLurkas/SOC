import { Module } from '@nestjs/common';
import { RulesController } from './rules.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RulesController],
})
export class RulesModule {}
