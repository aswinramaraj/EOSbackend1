import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ReportsAnalyticsService } from './reports-analytics.service';
import { ReportsAnalyticsController } from './reports-analytics.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ReportsAnalyticsController],
  providers: [ReportsAnalyticsService],
})
export class ReportsAnalyticsModule {}
