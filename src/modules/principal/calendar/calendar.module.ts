import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AcademicCalendarEventsModule } from 'src/modules/academic-structure/academic-calendar-events/academic-calendar-events.module';
import { PrincipalCalendarController } from './calendar.controller';
import { PrincipalCalendarService } from './calendar.service';

@Module({
  imports: [PrismaModule, AcademicCalendarEventsModule],
  controllers: [PrincipalCalendarController],
  providers: [PrincipalCalendarService],
})
export class PrincipalCalendarModule {}
