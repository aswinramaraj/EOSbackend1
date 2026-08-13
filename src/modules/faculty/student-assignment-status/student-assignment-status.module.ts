import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StudentAssignmentStatusService } from './student-assignment-status.service';
import { StudentAssignmentStatusController } from './student-assignment-status.controller';

@Module({
  imports: [PrismaModule],
  controllers: [StudentAssignmentStatusController],
  providers: [StudentAssignmentStatusService],
  exports: [StudentAssignmentStatusService],
})
export class StudentAssignmentStatusModule {}
