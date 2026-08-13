import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodEmployeeTimetableService } from './hod-employee-timetable.service';
import { HodEmployeeTimetableController } from './hod-employee-timetable.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodEmployeeTimetableController],
  providers: [HodEmployeeTimetableService],
})
export class HodEmployeeTimetableModule {}
