import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications/notifications.module';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { StudentFeedbackController } from './student-feedback.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [FeedbackController, StudentFeedbackController],
  providers: [FeedbackService],
  // Exported so HodModule can reuse getResults() for the HoD's own
  // department-scoped faculty-feedback viewing endpoint, instead of
  // duplicating that aggregation logic.
  exports: [FeedbackService],
})
export class FeedbackModule {}
