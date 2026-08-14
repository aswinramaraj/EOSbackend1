import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PersonalCalendarController } from './personal-calendar.controller';
import { PersonalCalendarService } from './personal-calendar.service';

@Module({
  imports: [PrismaModule],
  controllers: [PersonalCalendarController],
  providers: [PersonalCalendarService],
})
export class PersonalCalendarModule {}
