import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { HrQueriesService } from './hr-queries.service';
import { HrQueriesController } from './hr-queries.controller';
import { HrPayrollRequestsReviewController } from './hr-payroll-requests-review.controller';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [HrQueriesController, HrPayrollRequestsReviewController],
  providers: [HrQueriesService],
  exports: [HrQueriesService],
})
export class HrQueriesModule {}
