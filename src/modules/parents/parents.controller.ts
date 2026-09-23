import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { GetAttendanceDto } from 'src/modules/admissions/students/me-profile/dto/get-attendance.dto';
import { GetExamResultsDto } from 'src/modules/admissions/students/me-profile/dto/get-exam-results.dto';
import { GetMyTimetableQueryDto } from 'src/modules/faculty/timetable/dto/get-my-timetable-query.dto';
import { GetHostelNightAttendanceDto } from 'src/modules/admissions/students/me-profile/dto/get-hostel-night-attendance.dto';
import { CreateFeePaymentOrderDto } from 'src/modules/fees-billing/fee-payments/dto/create-fee-payment-order.dto';
import { VerifyFeePaymentDto } from 'src/modules/fees-billing/fee-payments/dto/verify-fee-payment.dto';
import { renderFeeReceiptPdf } from 'src/modules/admissions/students/me-profile/receipt-pdf.util';
import { renderMarksheetPdf } from 'src/modules/admissions/students/me-profile/marksheet-pdf.util';
import { SubmitParentFeedbackDto } from './dto/submit-parent-feedback.dto';
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

  /** GET /api/v1/me/children/:studentId/profile — Parent only, own child. */
  @Get('children/:studentId/profile')
  getChildProfile(@Param('studentId', ParseIntPipe) studentId: number, @CurrentUser() user: JwtPayload) {
    return this.parentsService.getChildProfile(user.sub, studentId);
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

  /**
   * GET /api/v1/me/children/:studentId/marksheet/:semester — Parent only,
   * own child. Returns a rendered PDF, not JSON - same
   * @Res()-opts-out-of-envelope pattern as getChildFeeReceipt below.
   */
  @Get('children/:studentId/marksheet/:semester')
  async getChildMarksheet(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('semester', ParseIntPipe) semester: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    if (semester < 1 || semester > 8) {
      throw new BadRequestException({
        message: 'semester must be between 1 and 8',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    const sheet = await this.parentsService.getChildMarksheet(user.sub, studentId, semester);
    const buffer = await renderMarksheetPdf(sheet);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Marksheet-Sem${semester}.pdf"`,
    });
    res.send(buffer);
  }

  /** GET /api/v1/me/children/:studentId/fees — Parent only, own child. */
  @Get('children/:studentId/fees')
  getChildFees(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildFees(user.sub, studentId);
  }

  /**
   * GET /api/v1/me/children/:studentId/fees/payments/:paymentId/receipt —
   * Parent only, own child. Returns a rendered PDF, not JSON - same
   * @Res()-opts-out-of-envelope pattern as the student's own
   * MeProfileController.getFeeReceipt.
   */
  @Get('children/:studentId/fees/payments/:paymentId/receipt')
  async getChildFeeReceipt(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const receipt = await this.parentsService.getChildFeeReceipt(user.sub, studentId, paymentId);
    const buffer = await renderFeeReceiptPdf(receipt);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${receipt.receipt_no}.pdf"`,
    });
    res.send(buffer);
  }

  /** POST /api/v1/me/children/:studentId/fees/demands/:id/payment-order — Parent only, own child. */
  @Post('children/:studentId/fees/demands/:id/payment-order')
  createChildFeePaymentOrder(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('id', ParseIntPipe) demandMappingId: number,
    @Body() dto: CreateFeePaymentOrderDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.payChildFeeDemand(user.sub, studentId, demandMappingId, dto);
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

  /**
   * GET /api/v1/me/children/:studentId/hostel-room — Parent only, own
   * child. Backs the Hostel tab (replaces "My Bus") shown once a parent's
   * child is a hosteller.
   */
  @Get('children/:studentId/hostel-room')
  getChildHostelRoom(@Param('studentId', ParseIntPipe) studentId: number, @CurrentUser() user: JwtPayload) {
    return this.parentsService.getChildHostelRoom(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/hostel-night-attendance?from=&to= — Parent only, own child. */
  @Get('children/:studentId/hostel-night-attendance')
  getChildNightAttendance(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: GetHostelNightAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildNightAttendance(user.sub, studentId, query);
  }

  /** GET /api/v1/me/children/:studentId/hostel-gate-log — Parent only, own child. */
  @Get('children/:studentId/hostel-gate-log')
  getChildGateLog(@Param('studentId', ParseIntPipe) studentId: number, @CurrentUser() user: JwtPayload) {
    return this.parentsService.getChildGateLog(user.sub, studentId);
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

  /** GET /api/v1/me/children/:studentId/leaves — Parent only, own child. Leave + Hostel Leave together (see getChildLeaves). */
  @Get('children/:studentId/leaves')
  getChildLeaves(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildLeaves(user.sub, studentId);
  }

  /** POST /api/v1/me/children/:studentId/leaves/:leaveId/acknowledge — Parent only, own child. */
  @Post('children/:studentId/leaves/:leaveId/acknowledge')
  acknowledgeChildLeave(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('leaveId', ParseIntPipe) leaveId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.acknowledgeChildLeave(user.sub, studentId, leaveId);
  }

  /** GET /api/v1/me/children/:studentId/od-requests — Parent only, own child. */
  @Get('children/:studentId/od-requests')
  getChildOdRequests(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildOdRequests(user.sub, studentId);
  }

  /** POST /api/v1/me/children/:studentId/od-requests/:odRequestId/acknowledge — Parent only, own child. */
  @Post('children/:studentId/od-requests/:odRequestId/acknowledge')
  acknowledgeChildOdRequest(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('odRequestId', ParseIntPipe) odRequestId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.acknowledgeChildOdRequest(user.sub, studentId, odRequestId);
  }

  /** GET /api/v1/me/children/:studentId/craveo-orders — Parent only, own child. Read-only order history. */
  @Get('children/:studentId/craveo-orders')
  getChildCraveoOrders(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildCraveoOrders(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/library-history — Parent only, own child. */
  @Get('children/:studentId/library-history')
  getChildLibraryHistory(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildLibraryHistory(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/medical-appointments — Parent only, own child. */
  @Get('children/:studentId/medical-appointments')
  getChildMedicalAppointments(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildMedicalAppointments(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/stationery-orders — Parent only, own child. */
  @Get('children/:studentId/stationery-orders')
  getChildStationeryOrders(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildStationeryOrders(user.sub, studentId);
  }

  /** GET /api/v1/me/children/:studentId/stationary-requests — Parent only, own child. Copy Center. */
  @Get('children/:studentId/stationary-requests')
  getChildStationaryRequests(
    @Param('studentId', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.getChildStationaryRequests(user.sub, studentId);
  }

  /** POST /api/v1/me/children/:studentId/feedback — Parent only, own child. Free-text feedback about this child. */
  @Post('children/:studentId/feedback')
  submitChildFeedback(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: SubmitParentFeedbackDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.parentsService.submitChildFeedback(user.sub, studentId, dto.message, dto.rating);
  }

  /** POST /api/v1/me/feedback/college — Parent only. Free-text feedback about the college, not tied to any one child. */
  @Post('feedback/college')
  submitCollegeFeedback(@Body() dto: SubmitParentFeedbackDto, @CurrentUser() user: JwtPayload) {
    return this.parentsService.submitCollegeFeedback(user.sub, dto.message, dto.rating);
  }
}
