import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { renderExcel, renderPdf } from 'src/common/utils/report-export.util';
import { PrincipalReportsService } from './reports.service';
import {
  PrincipalReportFormat,
  PrincipalReportQueryDto,
} from './dto/principal-report-query.dto';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * GET /api/v1/me/principal/reports/* — Principal only.
 * Mirrors SecretaryReportsController's json/excel/pdf export pattern
 * exactly (see report-export.util.ts, reused not duplicated).
 */
@Controller('me/principal/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalReportsController {
  constructor(private readonly reportsService: PrincipalReportsService) {}

  /** GET /me/principal/reports/summary — the Reports page's 3 headline cards. */
  @Get('summary')
  summary() {
    return this.reportsService.summary();
  }

  @Get('scorecard')
  async scorecard(
    @Query() query: PrincipalReportQueryDto,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.scorecard();

    if (query.format === PrincipalReportFormat.excel) {
      const buffer = await renderExcel(table);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${slugify(table.title)}.xlsx"`,
      });
      res.send(buffer);
      return;
    }

    if (query.format === PrincipalReportFormat.pdf) {
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
}
