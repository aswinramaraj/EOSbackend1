import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodEmployeeHrPayrollService } from './hod-employee-hr-payroll.service';
import { HodEmployeeHrPayrollController } from './hod-employee-hr-payroll.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodEmployeeHrPayrollController],
  providers: [HodEmployeeHrPayrollService],
})
export class HodEmployeeHrPayrollModule {}
