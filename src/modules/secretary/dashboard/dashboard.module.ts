import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { SecretaryDashboardController } from './dashboard.controller';
import { SecretaryDashboardService } from './dashboard.service';

@Module({
  imports: [PrismaModule],
  controllers: [SecretaryDashboardController],
  providers: [SecretaryDashboardService],
})
export class SecretaryDashboardModule {}
