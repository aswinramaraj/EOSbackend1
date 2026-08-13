import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PayslipRequestsModule } from 'src/modules/faculty/payslip-requests/payslip-requests.module';
import { HodEmployeePayslipService } from './hod-employee-payslip.service';
import { HodEmployeePayslipController } from './hod-employee-payslip.controller';

@Module({
  imports: [PrismaModule, PayslipRequestsModule],
  controllers: [HodEmployeePayslipController],
  providers: [HodEmployeePayslipService],
})
export class HodEmployeePayslipModule {}
