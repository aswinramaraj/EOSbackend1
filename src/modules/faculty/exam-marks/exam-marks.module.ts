import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { ExamMarksService } from './exam-marks.service';
import { ExamMarksController } from './exam-marks.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ExamMarksController],
  providers: [ExamMarksService],
})
export class ExamMarksModule {}
