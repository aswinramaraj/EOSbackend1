import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalFeedbackController } from './principal-feedback.controller';
import { PrincipalFeedbackService } from './principal-feedback.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalFeedbackController],
  providers: [PrincipalFeedbackService],
})
export class PrincipalFeedbackModule {}
