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
})
export class FeedbackModule {}
