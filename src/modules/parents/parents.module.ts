import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MeProfileModule } from 'src/modules/admissions/students/me-profile/me-profile.module';
import { TimetableModule } from 'src/modules/faculty/timetable/timetable.module';
import { DrivesModule } from 'src/modules/placement/drives/drives.module';
import { FeePaymentModule } from 'src/modules/fees-billing/fee-payments/fee-payment.module';
import { CanteenOrderingModule } from 'src/modules/canteen-ordering/canteen-ordering.module';
import { BorrowRecordsModule } from 'src/modules/library/borrow-records/borrow-records.module';
import { MedicalCentreModule } from 'src/modules/medical-centre/medical-centre.module';
import { HallTicketClearanceModule } from 'src/modules/hall-ticket-clearance/hall-ticket-clearance.module';
import { LmsModule } from 'src/modules/lms/lms.module';
import { StudentHigherEducationModule } from 'src/modules/student-higher-education/student-higher-education.module';
import { StudentEntrepreneurshipModule } from 'src/modules/student-entrepreneurship/student-entrepreneurship.module';
import { ParentsController } from './parents.controller';
import { ParentsService } from './parents.service';

@Module({
  imports: [
    PrismaModule,
    MeProfileModule,
    TimetableModule,
    DrivesModule,
    FeePaymentModule,
    CanteenOrderingModule,
    BorrowRecordsModule,
    MedicalCentreModule,
    HallTicketClearanceModule,
    LmsModule,
    StudentHigherEducationModule,
    StudentEntrepreneurshipModule,
  ],
  controllers: [ParentsController],
  providers: [ParentsService],
})
export class ParentsModule {}
