import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodEmployeeService } from './hod-employee.service';
import { CreateFacultyLeafDto } from '../faculty/faculty-leaves/dto/create-faculty-leaf.dto';
import { CreateFacultyOdDto } from '../faculty/faculty-od/dto/create-faculty-od.dto';
import { CreateHrQueryDto } from '../faculty/hr-queries/dto/create-hr-query.dto';
import { CreatePayslipRequestDto } from '../faculty/payslip-requests/dto/create-payslip-request.dto';
import { CreateAppraisalDto } from '../faculty/appraisal/dto/create-appraisal.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hod/employee')
@Roles(ROLES.HOD)
export class HodEmployeeController {
  constructor(private readonly hodEmployee: HodEmployeeService) {}

  @Get('attendance')
  getAttendance(
    @CurrentUser() user: JwtPayload,
    @Query('academic_year') academicYear?: string,
  ) {
    return this.hodEmployee.getMyAttendance(user, academicYear);
  }

  @Get('timetable')
  getTimetableDay(
    @CurrentUser() user: JwtPayload,
    @Query('date') date?: string,
  ) {
    return this.hodEmployee.getTimetableDay(user, date);
  }

  @Get('timetable/week')
  getTimetableWeek(
    @CurrentUser() user: JwtPayload,
    @Query('date') date?: string,
  ) {
    return this.hodEmployee.getTimetableWeek(user, date);
  }

  @Get('leave/types')
  getLeaveTypes() {
    return this.hodEmployee.getLeaveTypes();
  }

  @Get('leave/balances')
  getLeaveBalances(
    @CurrentUser() user: JwtPayload,
    @Query('academic_year') academicYear?: string,
  ) {
    return this.hodEmployee.getLeaveBalances(user, academicYear);
  }

  @Get('leave/history')
  getLeaveHistory(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: 'pending' | 'approved' | 'rejected',
  ) {
    return this.hodEmployee.getLeaveHistory(user, status);
  }

  @Post('leave')
  applyLeave(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFacultyLeafDto,
  ) {
    return this.hodEmployee.applyLeave(user, dto);
  }

  @Get('od/history')
  getOdHistory(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: 'pending' | 'approved' | 'rejected',
  ) {
    return this.hodEmployee.getOdHistory(user, status);
  }

  @Post('od')
  applyOd(@CurrentUser() user: JwtPayload, @Body() dto: CreateFacultyOdDto) {
    return this.hodEmployee.applyOd(user, dto);
  }

  @Get('hr-payroll/requests')
  getHrPayrollRequests(@CurrentUser() user: JwtPayload) {
    return this.hodEmployee.getHrPayrollRequests(user);
  }

  @Post('hr-payroll/requests')
  createHrPayrollRequest(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateHrQueryDto,
  ) {
    return this.hodEmployee.createHrPayrollRequest(user, dto);
  }

  @Get('payslip/history')
  getPayslipHistory(@CurrentUser() user: JwtPayload) {
    return this.hodEmployee.getPayslipHistory(user);
  }

  @Post('payslip')
  applyPayslip(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePayslipRequestDto,
  ) {
    return this.hodEmployee.applyPayslip(user, dto);
  }

  @Get('appraisal/criteria')
  getAppraisalCriteria() {
    return this.hodEmployee.getAppraisalCriteria();
  }

  @Get('appraisal/history')
  getAppraisalHistory(@CurrentUser() user: JwtPayload) {
    return this.hodEmployee.getAppraisalHistory(user);
  }

  @Post('appraisal')
  applyAppraisal(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAppraisalDto,
  ) {
    return this.hodEmployee.applyAppraisal(user, dto);
  }

  @Get('library')
  getLibraryOverview(@CurrentUser() user: JwtPayload) {
    return this.hodEmployee.getLibraryOverview(user);
  }
}
