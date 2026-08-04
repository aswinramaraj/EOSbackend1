import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { HostelReportsService } from './reports.service';
import {
  HostelReportFormat,
  HostelReportQueryDto,
} from './dto/hostel-report-query.dto';
import {
  renderExcel,
  renderPdf,
  type ReportTable,
} from 'src/modules/library/reports/report-export.util';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Controller('hostel/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
export class HostelReportsController {
  constructor(private readonly reportsService: HostelReportsService) {}

  private async respond(
    table: ReportTable,
    format: HostelReportFormat | undefined,
    res: Response,
  ) {
    if (format === HostelReportFormat.excel) {
      const buffer = await renderExcel(table);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${slugify(table.title)}.xlsx"`,
      });
      res.send(buffer);
      return;
    }

    if (format === HostelReportFormat.pdf) {
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

  @Get('occupancy')
  async occupancy(@Query() query: HostelReportQueryDto, @Res() res: Response) {
    const table = await this.reportsService.occupancy(query.hostel_id);
    await this.respond(table, query.format, res);
  }

  @Get('fee-arrears')
  async feeArrears(@Query() query: HostelReportQueryDto, @Res() res: Response) {
    const table = await this.reportsService.feeArrears(query.hostel_id);
    await this.respond(table, query.format, res);
  }

  @Get('leave-audit')
  async leaveAudit(@Query() query: HostelReportQueryDto, @Res() res: Response) {
    const table = await this.reportsService.leaveAudit(
      query.hostel_id,
      query.from,
      query.to,
    );
    await this.respond(table, query.format, res);
  }

  @Get('complaint-sla')
  async complaintSla(
    @Query() query: HostelReportQueryDto,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.complaintSla(query.hostel_id);
    await this.respond(table, query.format, res);
  }
}
