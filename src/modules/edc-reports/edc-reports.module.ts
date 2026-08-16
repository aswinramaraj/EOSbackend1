import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { EdcReportsController } from './edc-reports.controller';
import { EdcReportsService } from './edc-reports.service';

@Module({
  imports: [PrismaModule],
  controllers: [EdcReportsController],
  providers: [EdcReportsService],
})
export class EdcReportsModule {}
