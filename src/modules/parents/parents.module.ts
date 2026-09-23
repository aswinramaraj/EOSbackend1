import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MeProfileModule } from 'src/modules/admissions/students/me-profile/me-profile.module';
import { TimetableModule } from 'src/modules/faculty/timetable/timetable.module';
import { DrivesModule } from 'src/modules/placement/drives/drives.module';
import { FeePaymentModule } from 'src/modules/fees-billing/fee-payments/fee-payment.module';
import { ProfileModule } from 'src/modules/profile/profile.module';
import { CanteenOrderingModule } from 'src/modules/canteen-ordering/canteen-ordering.module';
import { StationeryModule } from 'src/modules/stationery/stationery.module';
import { StationaryModule } from 'src/modules/stationary/stationary.module';
import { MedicalCentreModule } from 'src/modules/medical-centre/medical-centre.module';
import { BorrowRecordsModule } from 'src/modules/library/borrow-records/borrow-records.module';
import { ParentsController } from './parents.controller';
import { ParentsService } from './parents.service';

@Module({
  imports: [
    PrismaModule,
    MeProfileModule,
    TimetableModule,
    DrivesModule,
    FeePaymentModule,
    ProfileModule,
    CanteenOrderingModule,
    StationeryModule,
    StationaryModule,
    MedicalCentreModule,
    BorrowRecordsModule,
  ],
  controllers: [ParentsController],
  providers: [ParentsService],
})
export class ParentsModule {}
