import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MediaRoomTeamController } from './media-room-team.controller';
import { MediaRoomTeamService } from './media-room-team.service';
import { MediaRoomEquipmentController } from './media-room-equipment.controller';
import { MediaRoomEquipmentService } from './media-room-equipment.service';
import { MediaRoomShootsController } from './media-room-shoots.controller';
import { MediaRoomShootsService } from './media-room-shoots.service';
import { MediaRoomIndentsController } from './media-room-indents.controller';
import { MediaRoomIndentsService } from './media-room-indents.service';
import { MediaRoomAttendanceController } from './media-room-attendance.controller';
import { MediaRoomAttendanceService } from './media-room-attendance.service';
import { MediaRoomLeaveController } from './media-room-leave.controller';
import { MediaRoomLeaveService } from './media-room-leave.service';
import { MediaRoomOdController } from './media-room-od.controller';
import { MediaRoomOdService } from './media-room-od.service';
import { MediaRoomHrPayrollController } from './media-room-hr-payroll.controller';
import { MediaRoomHrPayrollService } from './media-room-hr-payroll.service';
import { MediaRoomPayslipController } from './media-room-payslip.controller';
import { MediaRoomPayslipService } from './media-room-payslip.service';
import { MediaRoomAppraisalController } from './media-room-appraisal.controller';
import { MediaRoomAppraisalService } from './media-room-appraisal.service';
import { MediaRoomLibraryController } from './media-room-library.controller';
import { MediaRoomLibraryService } from './media-room-library.service';
import { MediaRoomReportsController } from './media-room-reports.controller';
import { MediaRoomReportsService } from './media-room-reports.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    MediaRoomTeamController,
    MediaRoomEquipmentController,
    MediaRoomShootsController,
    MediaRoomIndentsController,
    MediaRoomAttendanceController,
    MediaRoomLeaveController,
    MediaRoomOdController,
    MediaRoomHrPayrollController,
    MediaRoomPayslipController,
    MediaRoomAppraisalController,
    MediaRoomLibraryController,
    MediaRoomReportsController,
  ],
  providers: [
    MediaRoomTeamService,
    MediaRoomEquipmentService,
    MediaRoomShootsService,
    MediaRoomIndentsService,
    MediaRoomAttendanceService,
    MediaRoomLeaveService,
    MediaRoomOdService,
    MediaRoomHrPayrollService,
    MediaRoomPayslipService,
    MediaRoomAppraisalService,
    MediaRoomLibraryService,
    MediaRoomReportsService,
  ],
})
export class MediaRoomModule {}
