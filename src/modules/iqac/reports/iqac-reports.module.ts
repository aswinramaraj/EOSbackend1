import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { IqacReportsService } from './iqac-reports.service';
import { IqacReportsController } from './iqac-reports.controller';

@Module({
  imports: [PrismaModule],
  controllers: [IqacReportsController],
  providers: [IqacReportsService],
})
export class IqacReportsModule {}
