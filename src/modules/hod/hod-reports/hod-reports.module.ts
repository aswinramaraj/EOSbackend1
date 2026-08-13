import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodReportsService } from './hod-reports.service';
import { HodReportsController } from './hod-reports.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodReportsController],
  providers: [HodReportsService],
  exports: [HodReportsService],
})
export class HodReportsModule {}
