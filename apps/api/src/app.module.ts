import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { FavoritesModule } from './favorites/favorites.module';
import { CompaniesModule } from './companies/companies.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { LogsModule } from './logs/logs.module';
import { EventsModule } from './events/events.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [PrismaModule, EventsModule, UsersModule, FavoritesModule, CompaniesModule, WorkspacesModule, LogsModule, ChatModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
