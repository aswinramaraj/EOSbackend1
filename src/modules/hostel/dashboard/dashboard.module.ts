import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HostelDashboardService } from './dashboard.service';
import { HostelDashboardController } from './dashboard.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HostelDashboardController],
  providers: [HostelDashboardService],
})
export class HostelDashboardModule {}
