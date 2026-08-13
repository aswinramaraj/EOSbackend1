import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyLeavesModule } from 'src/modules/faculty/faculty-leaves/faculty-leaves.module';
import { HodEmployeeLeaveService } from './hod-employee-leave.service';
import { HodEmployeeLeaveController } from './hod-employee-leave.controller';

@Module({
  imports: [PrismaModule, FacultyLeavesModule],
  controllers: [HodEmployeeLeaveController],
  providers: [HodEmployeeLeaveService],
})
export class HodEmployeeLeaveModule {}
