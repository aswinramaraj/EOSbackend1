import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { GetAttendanceDto } from 'src/modules/admissions/students/me-profile/dto/get-attendance.dto';
import { GetExamResultsDto } from 'src/modules/admissions/students/me-profile/dto/get-exam-results.dto';
import { GetMyTimetableQueryDto } from 'src/modules/faculty/timetable/dto/get-my-timetable-query.dto';
import { CreateFeePaymentOrderDto } from 'src/modules/fees-billing/fee-payments/dto/create-fee-payment-order.dto';
import { VerifyFeePaymentDto } from 'src/modules/fees-billing/fee-payments/dto/verify-fee-payment.dto';
import { GetMyBorrowRecordsDto } from 'src/modules/library/borrow-records/dto/get-my-borrow-records.dto';
import { GetLeavesDto } from 'src/modules/admissions/students/me-profile/dto/get-leaves.dto';
import { GetOdRequestsDto } from 'src/modules/admissions/students/me-profile/dto/get-od-requests.dto';
import { GetBonafideRequestsDto } from 'src/modules/admissions/students/me-profile/dto/get-bonafide-requests.dto';
import { GetHostelOutingsDto } from 'src/modules/admissions/students/me-profile/dto/get-hostel-outings.dto';
import { GetCampusOutingsDto } from 'src/modules/admissions/students/me-profile/dto/get-campus-outings.dto';
import { ListClearanceQueryDto } from 'src/modules/hall-ticket-clearance/dto/list-clearance-query.dto';
import { ParentsService } from './parents.service';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PARENT)
export class ParentsController {
  constructor(private readonly parentsService: ParentsService) {}

  /** GET /api/v1/me/children — Parent only. */
  @Get('children')
  listChildren(@CurrentUser() user: JwtPayload) {
    return this.parentsService.listChildren(user.sub);
  }

  /** GET /api/v1/me/children/:studentId/attendance?from=&to=&subject_id= — Parent only, own child. */
  @Get('children/:studentId/attendance')
  getChildAttendance(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: GetAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildAttendance(user.sub, studentId, query);
  }

  /** GET /api/v1/me/children/:studentId/performance?semester= — Parent only, own child. */
  @Get('children/:studentId/performance')
  getChildPerformance(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: GetExamResultsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildPerformance(user.sub, studentId, query);
  }

  /** GET /api/v1/me/children/:studentId/fees — Parent only, own child. */
  @Get('children/:studentId/fees')
  getChildFees(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildFees(user.sub, studentId);
  }

  /** POST /api/v1/me/children/:studentId/fees/demands/:id/payment-order — Parent only, own child. */
  @Post('children/:studentId/fees/demands/:id/payment-order')
  createChildFeePaymentOrder(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('id', ParseIntPipe) demandMappingId: number,
    @Body() dto: CreateFeePaymentOrderDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.payChildFeeDemand(
      user.sub,
      studentId,
      demandMappingId,
      dto,
    );
  }

  /** POST /api/v1/me/children/:studentId/fees/payment-order/verify — Parent only, own child. */
  @Post('children/:studentId/fees/payment-order/verify')
  verifyChildFeePayment(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: VerifyFeePaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.verifyChildFeePayment(user.sub, studentId, dto);
  }

  /** GET /api/v1/me/children/:studentId/timetable?day= — Parent only, own child. */
  @Get('children/:studentId/timetable')
  getChildTimetable(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: GetMyTimetableQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildTimetable(user.sub, studentId, query);
  }

  /** GET /api/v1/me/children/:studentId/academic-calendar — Parent only, own child. */
  @Get('children/:studentId/academic-calendar')
  getChildAcademicCalendar(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildAcademicCalendar(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/upcoming-drives — Parent only, own child. */
  @Get('children/:studentId/upcoming-drives')
  getChildUpcomingDrives(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildUpcomingDrives(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/placement-history — Parent only, own child. */
  @Get('children/:studentId/placement-history')
  getChildPlacementHistory(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildPlacementHistory(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/canteen-orders — Parent only, own child. */
  @Get('children/:studentId/canteen-orders')
  getChildCanteenOrders(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildCanteenOrders(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/library-records?status= — Parent only, own child. */
  @Get('children/:studentId/library-records')
  getChildLibraryRecords(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: GetMyBorrowRecordsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildLibraryRecords(
      user.sub,
      studentId,
      query,
    );
  }

  /** GET /api/v1/me/children/:studentId/medical-appointments — Parent only, own child. */
  @Get('children/:studentId/medical-appointments')
  getChildMedicalAppointments(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildMedicalAppointments(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/exam-schedule — Parent only, own child. */
  @Get('children/:studentId/exam-schedule')
  getChildExamSchedule(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildExamSchedule(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/career-path — Parent only, own child. */
  @Get('children/:studentId/career-path')
  getChildCareerPath(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildCareerPath(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/leaves — Parent only, own child. */
  @Get('children/:studentId/leaves')
  getChildLeaves(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: GetLeavesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildLeaves(user.sub, studentId, query);
  }

  /** GET /api/v1/me/children/:studentId/od-requests — Parent only, own child. */
  @Get('children/:studentId/od-requests')
  getChildOdRequests(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: GetOdRequestsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildOdRequests(user.sub, studentId, query);
  }

  /** GET /api/v1/me/children/:studentId/bonafide-requests — Parent only, own child. */
  @Get('children/:studentId/bonafide-requests')
  getChildBonafideRequests(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: GetBonafideRequestsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildBonafideRequests(
      user.sub,
      studentId,
      query,
    );
  }

  /** GET /api/v1/me/children/:studentId/clearance-requests — Parent only, own child ("No-due" tab). */
  @Get('children/:studentId/clearance-requests')
  getChildClearanceRequests(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: ListClearanceQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildClearanceRequests(
      user.sub,
      studentId,
      query,
    );
  }

  /** GET /api/v1/me/children/:studentId/hostel-room — Parent only, own child. */
  @Get('children/:studentId/hostel-room')
  getChildHostelRoom(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildHostelRoom(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/hostel-outings — Parent only, own child. */
  @Get('children/:studentId/hostel-outings')
  getChildHostelOutings(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: GetHostelOutingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildHostelOutings(
      user.sub,
      studentId,
      query,
    );
  }

  /** GET /api/v1/me/children/:studentId/campus-outings — Parent only, own child ("In / out request" tab). */
  @Get('children/:studentId/campus-outings')
  getChildCampusOutings(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: GetCampusOutingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildCampusOutings(
      user.sub,
      studentId,
      query,
    );
  }

  /** GET /api/v1/me/children/:studentId/higher-education — Parent only, own child. */
  @Get('children/:studentId/higher-education')
  getChildHigherEducation(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildHigherEducation(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/entrepreneurship — Parent only, own child ("My Venture" tab). */
  @Get('children/:studentId/entrepreneurship')
  getChildEntrepreneurship(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildEntrepreneurship(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/lms/subjects — Parent only, own child. */
  @Get('children/:studentId/lms/subjects')
  getChildLmsSubjects(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildLmsSubjects(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/lms/subjects/:subjectId/tasks — Parent only, own child. */
  @Get('children/:studentId/lms/subjects/:subjectId/tasks')
  getChildLmsTasks(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('subjectId', ParseIntPipe) subjectId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildLmsTasks(user.sub, studentId, subjectId);
  }
}
