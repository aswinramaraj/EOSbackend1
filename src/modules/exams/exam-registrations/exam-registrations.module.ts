import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ExamRegistrationsService } from './exam-registrations.service';
import { ExamRegistrationsController } from './exam-registrations.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ExamRegistrationsController],
  providers: [ExamRegistrationsService],
})
export class ExamRegistrationsModule {}
