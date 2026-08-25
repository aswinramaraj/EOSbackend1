import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyReportsService } from './reports.service';
import { FacultyReportsController } from './reports.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FacultyReportsController],
  providers: [FacultyReportsService],
})
export class FacultyReportsModule {}
