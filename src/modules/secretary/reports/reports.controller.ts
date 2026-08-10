import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import {
  renderExcel,
  renderPdf,
  type ReportTable,
} from 'src/common/utils/report-export.util';
import { SecretaryReportsService } from './reports.service';
import {
  SecretaryReportFormat,
  SecretaryReportQueryDto,
} from './dto/secretary-report-query.dto';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * GET /api/v1/me/secretary/reports/* — Secretary only, own data.
 * Mirrors LibraryReportsController/HostelReportsController's json/excel/pdf
 * export pattern exactly (see report-export.util.ts, reused rather than
 * duplicated).
 */
@Controller('me/secretary/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SECRETARY)
export class SecretaryReportsController {
  constructor(private readonly reportsService: SecretaryReportsService) {}

  private async respond(
    table: ReportTable,
    format: SecretaryReportFormat | undefined,
    res: Response,
  ) {
    if (format === SecretaryReportFormat.excel) {
      const buffer = await renderExcel(table);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${slugify(table.title)}.xlsx"`,
      });
      res.send(buffer);
      return;
    }

    if (format === SecretaryReportFormat.pdf) {
      const buffer = await renderPdf(table);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${slugify(table.title)}.pdf"`,
      });
      res.send(buffer);
      return;
    }

    // @Res() opts this handler out of the global TransformInterceptor, so
    // the JSON branch replicates the standard envelope manually.
    res.json({
      success: true,
      message: 'Success',
      data: table,
      timestamp: new Date().toISOString(),
    });
  }

  /** GET /me/secretary/reports/summary — the Reports page's pill stats. */
  @Get('summary')
  summary(@CurrentUser() user: JwtPayload) {
    return this.reportsService.summary(user.sub);
  }

  @Get('product-requests')
  async productRequests(
    @Query() query: SecretaryReportQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.productRequests(
      user.sub,
      query.from,
      query.to,
      query.status,
    );
    await this.respond(table, query.format, res);
  }

  @Get('service-requests')
  async serviceRequests(
    @Query() query: SecretaryReportQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.serviceRequests(
      user.sub,
      query.from,
      query.to,
      query.status,
    );
    await this.respond(table, query.format, res);
  }

  @Get('venue-bookings')
  async venueBookings(
    @Query() query: SecretaryReportQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.venueBookings(
      user.sub,
      query.from,
      query.to,
      query.status,
    );
    await this.respond(table, query.format, res);
  }

  @Get('media-requests')
  async mediaRequests(
    @Query() query: SecretaryReportQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.mediaRequests(
      user.sub,
      query.from,
      query.to,
      query.status,
    );
    await this.respond(table, query.format, res);
  }

  @Get('attendance')
  async attendance(
    @Query() query: SecretaryReportQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.attendance(
      user.sub,
      query.from,
      query.to,
      query.status,
    );
    await this.respond(table, query.format, res);
  }
}
