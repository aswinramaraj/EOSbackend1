import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AssignmentsModule } from 'src/modules/faculty/assignments/assignments.module';
import { StudentAssignmentStatusModule } from 'src/modules/faculty/student-assignment-status/student-assignment-status.module';
import { HodMyClassAssignmentStatusService } from './hod-my-class-assignment-status.service';
import { HodMyClassAssignmentStatusController } from './hod-my-class-assignment-status.controller';

@Module({
  imports: [PrismaModule, AssignmentsModule, StudentAssignmentStatusModule],
  controllers: [HodMyClassAssignmentStatusController],
  providers: [HodMyClassAssignmentStatusService],
})
export class HodMyClassAssignmentStatusModule {}
