import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PayslipRequestsService } from './payslip-requests.service';
import { PayslipRequestsController } from './payslip-requests.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PayslipRequestsController],
  providers: [PayslipRequestsService],
  exports: [PayslipRequestsService],
})
export class PayslipRequestsModule {}
