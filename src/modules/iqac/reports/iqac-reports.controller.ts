import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import {
  renderExcel,
  renderExcelWorkbook,
  renderPdf,
  renderPdfBundle,
  type ReportTable,
} from 'src/common/utils/report-export.util';
import { IqacReportsService } from './iqac-reports.service';
import {
  IqacReportQueryDto,
  IqacReportFormat,
} from './dto/iqac-report-query.dto';
import { IqacReportBundleQueryDto } from './dto/iqac-report-bundle-query.dto';
import { VenueHistoryQueryDto } from './dto/venue-history-query.dto';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Controller('iqac/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC, ROLES.ADMIN)
export class IqacReportsController {
  constructor(private readonly reportsService: IqacReportsService) {}

  /**
   * Same manual-envelope pattern as LibraryReportsController.respond -
   * @Res() (required for binary Excel/PDF bodies) opts the handler out of
   * the global TransformInterceptor, so the JSON branch replicates its
   * envelope by hand.
   */
  private async respond(
    table: ReportTable,
    format: IqacReportFormat | undefined,
    res: Response,
  ) {
    if (format === IqacReportFormat.excel) {
      const buffer = await renderExcel(table);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${slugify(table.title)}.xlsx"`,
      });
      res.send(buffer);
      return;
    }

    if (format === IqacReportFormat.pdf) {
      const buffer = await renderPdf(table);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${slugify(table.title)}.pdf"`,
      });
      res.send(buffer);
      return;
    }

    res.json({
      success: true,
      message: 'Success',
      data: table,
      timestamp: new Date().toISOString(),
    });
  }

  @Get('venue-bookings')
  async venueBookings(
    @Query() query: IqacReportQueryDto,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.venueBookingsReport(query);
    await this.respond(table, query.format, res);
  }

  @Get('student-ods')
  async studentOds(@Query() query: IqacReportQueryDto, @Res() res: Response) {
    const table = await this.reportsService.studentOdsReport(query);
    await this.respond(table, query.format, res);
  }

  @Get('faculty-ods')
  async facultyOds(@Query() query: IqacReportQueryDto, @Res() res: Response) {
    const table = await this.reportsService.facultyOdsReport(query);
    await this.respond(table, query.format, res);
  }

  /** GET /iqac/reports/venue-history?date= — always JSON, goes through the normal envelope. */
  @Get('venue-history')
  venueHistory(@Query() query: VenueHistoryQueryDto) {
    return this.reportsService.venueHistory(query);
  }

  /** GET /iqac/reports/scorecard — always JSON, goes through the normal envelope. */
  @Get('scorecard')
  scorecard() {
    return this.reportsService.scorecard();
  }

  /**
   * GET /iqac/reports/bundle?types=venue_bookings,student_ods&format=excel|pdf
   * The admin portal's "Build a download" checklist + single download
   * button — one workbook (Excel, one sheet per type) or one concatenated
   * PDF covering every selected report type.
   */
  @Get('bundle')
  async bundle(@Query() query: IqacReportBundleQueryDto, @Res() res: Response) {
    const reportQuery: IqacReportQueryDto = {
      from: query.from,
      to: query.to,
      department_id: query.department_id,
    };

    const tableBuilders: Record<string, () => Promise<ReportTable>> = {
      venue_bookings: () =>
        this.reportsService.venueBookingsReport(reportQuery),
      student_ods: () => this.reportsService.studentOdsReport(reportQuery),
      faculty_ods: () => this.reportsService.facultyOdsReport(reportQuery),
    };

    const tables = await Promise.all(
      query.types.map((t) => tableBuilders[t]()),
    );

    if (query.format === 'excel') {
      const buffer = await renderExcelWorkbook(tables);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="iqac-report-bundle.xlsx"',
      });
      res.send(buffer);
      return;
    }

    const buffer = await renderPdfBundle(tables);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="iqac-report-bundle.pdf"',
    });
    res.send(buffer);
  }
}
