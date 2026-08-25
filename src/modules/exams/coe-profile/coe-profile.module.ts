import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CoeProfileService } from './coe-profile.service';
import { CoeProfileController } from './coe-profile.controller';
import { CoeDashboardService } from './coe-dashboard.service';
import { CoeDashboardController } from './coe-dashboard.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CoeProfileController, CoeDashboardController],
  providers: [CoeProfileService, CoeDashboardService],
})
export class CoeProfileModule {}
