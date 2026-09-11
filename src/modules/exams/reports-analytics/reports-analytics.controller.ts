import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';
import { ReportsAnalyticsService } from './reports-analytics.service';
import { ReportsAnalyticsQueryDto } from './dto/reports-analytics-query.dto';

@Controller('reports-analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class ReportsAnalyticsController {
  constructor(
    private readonly reportsAnalyticsService: ReportsAnalyticsService,
  ) {}

  @Get('summary')
  async getSummary(@Query() query: ReportsAnalyticsQueryDto) {
    const summary = await this.reportsAnalyticsService.getSummary(
      query.exam_id,
    );
    return ApiResponse.ok(
      summary,
      'Reports & analytics summary fetched successfully.',
    );
  }
}
