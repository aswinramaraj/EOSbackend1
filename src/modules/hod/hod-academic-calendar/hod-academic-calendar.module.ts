import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodAcademicCalendarService } from './hod-academic-calendar.service';
import { HodAcademicCalendarController } from './hod-academic-calendar.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodAcademicCalendarController],
  providers: [HodAcademicCalendarService],
})
export class HodAcademicCalendarModule {}
