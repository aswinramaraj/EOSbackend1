import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MessFeedbackService } from './mess-feedback.service';
import { MessFeedbackController } from './mess-feedback.controller';

@Module({
  imports: [PrismaModule],
  controllers: [MessFeedbackController],
  providers: [MessFeedbackService],
})
export class MessFeedbackModule {}
