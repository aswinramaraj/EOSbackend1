import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalDashboardModule } from 'src/modules/principal/dashboard/dashboard.module';
import { PrincipalPlacementsModule } from 'src/modules/principal/placements/placements.module';
import { PrincipalHigherEducationModule } from 'src/modules/principal/higher-education/higher-education.module';
import { IqacDashboardController } from './iqac-dashboard.controller';
import { IqacDashboardService } from './iqac-dashboard.service';

@Module({
  imports: [
    PrismaModule,
    PrincipalDashboardModule,
    PrincipalPlacementsModule,
    PrincipalHigherEducationModule,
  ],
  controllers: [IqacDashboardController],
  providers: [IqacDashboardService],
})
export class IqacDashboardModule {}
