import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { SportsDashboardService } from './dashboard.service';
import { SportsDashboardController } from './dashboard.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SportsDashboardController],
  providers: [SportsDashboardService],
  exports: [SportsDashboardService],
})
export class SportsDashboardModule {}
