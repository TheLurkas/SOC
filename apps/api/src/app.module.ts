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
import { AlertsModule } from './alerts/alerts.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RulesModule } from './rules/rules.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { UsageModule } from './usage/usage.module';
import { AnalysisModule } from './analysis/analysis.module';

@Module({
  imports: [PrismaModule, EventsModule, UsersModule, FavoritesModule, CompaniesModule, WorkspacesModule, LogsModule, ChatModule, AlertsModule, NotificationsModule, RulesModule, DashboardModule, UsageModule, AnalysisModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
