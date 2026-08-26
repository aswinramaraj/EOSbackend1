import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { IqacCalendarController } from './iqac-calendar.controller';
import { IqacCalendarService } from './iqac-calendar.service';

@Module({
  imports: [PrismaModule],
  controllers: [IqacCalendarController],
  providers: [IqacCalendarService],
  exports: [IqacCalendarService],
})
export class IqacCalendarModule {}
