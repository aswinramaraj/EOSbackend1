import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FinanceOverviewService } from './finance-overview.service';
import { FinanceOverviewController } from './finance-overview.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FinanceOverviewController],
  providers: [FinanceOverviewService],
})
export class FinanceOverviewModule {}
