import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HrReportsService } from './hr-reports.service';
import {
  HrReportDocumentsService,
  HR_REPORT_KINDS,
  isHrReportKind,
} from './hr-report-documents.service';
import {
  renderHrReportExcel,
  renderHrReportPdf,
  reportFilename,
} from './hr-report-export.util';

/**
 * HR payroll reporting. Read-only aggregations of salary_payments,
 * salary_divisions, faculty, non_teaching_staff, faculty_leaves and
 * faculty_od_requests — nothing here writes.
 */
@Controller('hr/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HR_PAYROLL, ROLES.ADMIN)
export class HrReportsController {
  constructor(
    private readonly service: HrReportsService,
    private readonly documents: HrReportDocumentsService,
  ) {}

  /**
   * GET /api/v1/hr/reports/catalogue
   * The reports that can actually be produced, so the UI never offers one that
   * has no builder behind it.
   *
   * Declared above the parameterised routes for the same reason as
   * available-years below: Nest matches in declaration order.
   */
  @Get('catalogue')
  catalogue() {
    return this.documents.catalogue();
  }

  /**
   * GET /api/v1/hr/reports/export?report=&format=&year=&department_id=&faculty_id=
   *
   * Streams a real .xlsx or .pdf. The filename is derived from the report and
   * its scope, so the two department reports and an employee statement never
   * collide in the download folder.
   */
  @Get('export')
  async export(
    @Query('report') report: string,
    @Query('format') format: string,
    @Res() res: Response,
    @Query('year') year?: string,
    @Query('department_id') departmentId?: string,
    @Query('faculty_id') facultyId?: string,
  ) {
    if (!report || !isHrReportKind(report)) {
      throw new BadRequestException({
        message: `Unknown report. Expected one of: ${HR_REPORT_KINDS.join(', ')}.`,
        errorCode: 'UNKNOWN_REPORT',
      });
    }
    const fmt = (format ?? 'excel').toLowerCase();
    if (fmt !== 'excel' && fmt !== 'pdf') {
      throw new BadRequestException({
        message: 'format must be "excel" or "pdf".',
        errorCode: 'UNKNOWN_FORMAT',
      });
    }

    const numeric = (v?: string): number | undefined => {
      if (v === undefined || v === '') return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        throw new BadRequestException({
          message: 'year, department_id and faculty_id must be whole numbers.',
          errorCode: 'INVALID_QUERY',
        });
      }
      return n;
    };

    const doc = await this.documents.build(report, {
      fy: numeric(year),
      departmentId: numeric(departmentId),
      facultyId: numeric(facultyId),
    });

    const name = reportFilename(doc);

    if (fmt === 'excel') {
      const buffer = await renderHrReportExcel(doc);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${name}.xlsx"`,
        'Content-Length': String(buffer.length),
      });
      res.send(buffer);
      return;
    }

    const buffer = await renderHrReportPdf(doc);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}.pdf"`,
      'Content-Length': String(buffer.length),
    });
    res.send(buffer);
  }

  /**
   * GET /api/v1/hr/reports/annual-statement/available-years
   * Declared before the parameterised sibling below so the literal segment is
   * not captured by it.
   */
  @Get('annual-statement/available-years')
  availableYears() {
    return this.service.availableYears();
  }

  /** GET /api/v1/hr/reports/payroll-summary?year= — year is the FY start (2026 = FY 2026-27). */
  @Get('payroll-summary')
  payrollSummary(@Query('year') year?: string) {
    return this.service.payrollSummary(year ? Number(year) : undefined);
  }

  /** GET /api/v1/hr/reports/annual-statement?faculty_id=&year= */
  @Get('annual-statement')
  annualStatement(
    @Query('faculty_id', new DefaultValuePipe(0), ParseIntPipe) facultyId: number,
    @Query('year') year?: string,
  ) {
    return this.service.annualStatement(facultyId, year ? Number(year) : undefined);
  }
}
