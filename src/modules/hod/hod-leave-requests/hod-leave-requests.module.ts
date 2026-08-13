import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StudentLeavesModule } from 'src/modules/admissions/student-leaves/student-leaves.module';
import { FacultyLeavesModule } from 'src/modules/faculty/faculty-leaves/faculty-leaves.module';
import { HodLeaveRequestsService } from './hod-leave-requests.service';
import { HodLeaveRequestsController } from './hod-leave-requests.controller';

@Module({
  imports: [PrismaModule, StudentLeavesModule, FacultyLeavesModule],
  controllers: [HodLeaveRequestsController],
  providers: [HodLeaveRequestsService],
})
export class HodLeaveRequestsModule {}
