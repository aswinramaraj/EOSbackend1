import { Module } from '@nestjs/common';
import { AcademicCalendarEventsService } from './academic-calendar-events.service';
import { AcademicCalendarEventsController } from './academic-calendar-events.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicCalendarEventsController],
  providers: [AcademicCalendarEventsService],
  exports: [AcademicCalendarEventsService],
})
export class AcademicCalendarEventsModule {}
