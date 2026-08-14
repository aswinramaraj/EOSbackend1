import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HrDepartmentsModule } from '../hr-departments/hr-departments.module';
import { HrDashboardService } from './hr-dashboard.service';
import { HrDashboardController } from './hr-dashboard.controller';

@Module({
  imports: [PrismaModule, HrDepartmentsModule],
  controllers: [HrDashboardController],
  providers: [HrDashboardService],
})
export class HrDashboardModule {}
