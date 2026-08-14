import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { HrDepartmentsService } from '../hr-departments/hr-departments.service';

function todayDateOnly(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

/**
 * HR Dashboard — aggregates existing tables only (faculty, faculty_leaves,
 * faculty_od_requests, appraisal_requests, salary_payments, departments).
 * No new tables; follows the same "domain dashboard" shape as
 * LibraryDashboardModule/HostelDashboardModule.
 */
@Injectable()
export class HrDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hrDepartmentsService: HrDepartmentsService,
  ) {}

  async getSummary() {
    const today = todayDateOnly();
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const [
      pendingLeaves,
      pendingOdRequests,
      todaysLeave,
      todaysOd,
      pendingAppraisals,
      payrollThisMonth,
      payrollProcessedThisMonth,
      totalActiveFaculty,
      departmentOverview,
    ] = await Promise.all([
      this.prisma.faculty_leaves.count({
        where: {
          OR: [
            { hod_approval_status: 'pending' },
            { hr_approval_status: 'pending' },
          ],
        },
      }),
      this.prisma.faculty_od_requests.count({
        where: {
          OR: [
            { hod_approval_status: 'pending' },
            { hr_approval_status: 'pending' },
          ],
        },
      }),
      this.prisma.faculty_leaves.count({
        where: {
          hod_approval_status: 'approved',
          hr_approval_status: 'approved',
          from_date: { lte: today },
          to_date: { gte: today },
        },
      }),
      this.prisma.faculty_od_requests.count({
        where: {
          hod_approval_status: 'approved',
          hr_approval_status: 'approved',
          from_date: { lte: today },
          to_date: { gte: today },
        },
      }),
      // "Pending appraisals" = awaiting HR's next action — either HoD has
      // reviewed and HR still needs to score it ('hod_reviewed'), or HR has
      // already scored it and still needs to approve/reject to finalize
      // ('hr_scored'). Both stages are unfinished HR work; counting only
      // 'hod_reviewed' silently dropped the 'hr_scored' ones.
      this.prisma.appraisal_requests.count({
        where: { status: { in: ['hod_reviewed', 'hr_scored'] } },
      }),
      this.prisma.salary_payments.count({
        where: { payee_type: 'faculty', month, year },
      }),
      this.prisma.salary_payments.count({
        where: {
          payee_type: 'faculty',
          month,
          year,
          paid_at: { not: null },
        },
      }),
      this.prisma.faculty.count({ where: { status: 'active' } }),
      this.hrDepartmentsService.findAll(),
    ]);

    // No `status` column exists on salary_payments yet (pending schema
    // change) — `paid_at IS NOT NULL` is used as the "processed" proxy in
    // the meantime, against whichever is the larger, more meaningful
    // denominator: rows created for this month, or total active faculty if
    // the payroll run for this month hasn't been started yet.
    const payrollDenominator = Math.max(payrollThisMonth, totalActiveFaculty);
    const payrollCompletionPercent = payrollDenominator
      ? Math.round((payrollProcessedThisMonth / payrollDenominator) * 100)
      : 0;

    return {
      pending_requests_count: pendingLeaves + pendingOdRequests,
      todays_leave_count: todaysLeave,
      todays_od_count: todaysOd,
      pending_appraisals_count: pendingAppraisals,
      payroll: {
        month,
        year,
        total_active_faculty: totalActiveFaculty,
        processed_count: payrollProcessedThisMonth,
        completion_percent: payrollCompletionPercent,
      },
      department_overview: departmentOverview,
    };
  }
}
