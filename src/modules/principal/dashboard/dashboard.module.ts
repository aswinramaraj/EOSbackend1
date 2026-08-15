import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalDashboardController } from './dashboard.controller';
import { PrincipalDashboardService } from './dashboard.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalDashboardController],
  providers: [PrincipalDashboardService],
  exports: [PrincipalDashboardService],
})
export class PrincipalDashboardModule {}
