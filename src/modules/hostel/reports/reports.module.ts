import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HostelReportsService } from './reports.service';
import { HostelReportsController } from './reports.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HostelReportsController],
  providers: [HostelReportsService],
})
export class HostelReportsModule {}
