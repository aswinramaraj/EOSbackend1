import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HrReportsController } from './hr-reports.controller';
import { HrReportsService } from './hr-reports.service';
import { HrReportDocumentsService } from './hr-report-documents.service';

@Module({
  imports: [PrismaModule],
  controllers: [HrReportsController],
  providers: [HrReportsService, HrReportDocumentsService],
})
export class HrReportsModule {}
