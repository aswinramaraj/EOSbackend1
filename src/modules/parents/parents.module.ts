import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MeProfileModule } from 'src/modules/admissions/students/me-profile/me-profile.module';
import { TimetableModule } from 'src/modules/faculty/timetable/timetable.module';
import { DrivesModule } from 'src/modules/placement/drives/drives.module';
import { FeePaymentModule } from 'src/modules/fees-billing/fee-payments/fee-payment.module';
import { ParentsController } from './parents.controller';
import { ParentsService } from './parents.service';

@Module({
  imports: [PrismaModule, MeProfileModule, TimetableModule, DrivesModule, FeePaymentModule],
  controllers: [ParentsController],
  providers: [ParentsService],
})
export class ParentsModule {}
