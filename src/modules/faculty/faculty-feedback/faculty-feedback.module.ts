import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyFeedbackService } from './faculty-feedback.service';
import {
  HodFacultyFeedbackFormsController,
  MyFacultyFeedbackController,
} from './faculty-feedback.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodFacultyFeedbackFormsController, MyFacultyFeedbackController],
  providers: [FacultyFeedbackService],
})
export class FacultyFeedbackModule {}
