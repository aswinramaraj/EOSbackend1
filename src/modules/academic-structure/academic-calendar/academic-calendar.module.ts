import { Module } from '@nestjs/common';
import { AcademicCalendarService } from './academic-calendar.service';
import { AcademicCalendarController } from './academic-calendar.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicCalendarController],
  providers: [AcademicCalendarService],
})
export class AcademicCalendarModule {}
