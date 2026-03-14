import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import type { GenerateReportDto } from '@soc/shared';

@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('generate')
  async generate(@Body() body: GenerateReportDto, @CurrentUser() user: any) {
    const data = await this.reports.generateReport(user.id, body);
    return { data };
  }
}
