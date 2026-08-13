import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodTimetableService } from './hod-timetable.service';
import { HodTimetableController } from './hod-timetable.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodTimetableController],
  providers: [HodTimetableService],
})
export class HodTimetableModule {}
