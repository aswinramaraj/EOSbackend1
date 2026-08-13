import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { EdcReportsService } from './edc-reports.service';
import { GenerateReportQueryDto, ReportFormat } from './dto/generate-report-query.dto';
import { CreateReportRecordDto } from './dto/create-report-record.dto';
import type { ReportTable } from 'src/modules/library/reports/report-export.util';
import { buildEdcExcel, buildEdcPdf } from './edc-report-export.util';

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** EDC Coordinator's Reports screen — live KPIs/table from real venture
 * data (no new table needed for the numbers), plus a small `edc_reports`
 * table logging what's been generated (the "Report Library"), added this
 * session. Export reuses library/reports' existing Excel/PDF renderer. */
@Controller('me/edc-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.EDC_COORDINATOR)
export class EdcReportsController {
  constructor(private readonly service: EdcReportsService) {}

  @Get('stats')
  stats() {
    return this.service.stats();
  }

  @Get('library')
  library() {
    return this.service.listLibrary();
  }

  @Get('venture-table')
  async ventureTable(@Query() query: GenerateReportQueryDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const table: ReportTable = await this.service.ventureTable();
    const periodLabel = query.period ?? 'All time';

    if (query.format === ReportFormat.excel) {
      const stats = await this.service.stats();
      const buffer = await buildEdcExcel(stats, table, periodLabel, user.email);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${slugify(table.title)}.xlsx"`,
      });
      res.send(buffer);
      return;
    }
    if (query.format === ReportFormat.pdf) {
      const stats = await this.service.stats();
      const buffer = await buildEdcPdf(stats, table, periodLabel, user.email);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${slugify(table.title)}.pdf"`,
      });
      res.send(buffer);
      return;
    }

    // @Res() opts this handler out of the global TransformInterceptor, so
    // the plain-JSON branch replicates its envelope manually — same
    // approach library/reports.controller.ts already uses.
    res.json({ success: true, message: 'Success', data: table, timestamp: new Date().toISOString() });
  }

  @Post('library')
  @HttpCode(HttpStatus.CREATED)
  logGenerated(@Body() dto: CreateReportRecordDto, @CurrentUser() user: JwtPayload) {
    return this.service.logGenerated(dto, user.sub);
  }
}
