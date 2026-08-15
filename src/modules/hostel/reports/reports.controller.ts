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
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrismaService } from 'src/prisma/prisma.service';
import { resolveWardenHostelId } from '../common/warden-scope.util';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Controller('hostel/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN, ROLES.WARDEN)
export class HostelReportsController {
  constructor(
    private readonly reportsService: HostelReportsService,
    private readonly prisma: PrismaService,
  ) {}

  private async effectiveHostelId(
    user: JwtPayload,
    requested?: number,
  ): Promise<number | undefined> {
    const wardenHostelId = await resolveWardenHostelId(this.prisma, user.sub);
    return wardenHostelId ?? requested;
  }

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
  async occupancy(
    @Query() query: HostelReportQueryDto,
    @Res() res: Response,
    @CurrentUser() user: JwtPayload,
  ) {
    const hostelId = await this.effectiveHostelId(user, query.hostel_id);
    const table = await this.reportsService.occupancy(hostelId);
    await this.respond(table, query.format, res);
  }

  @Get('fee-arrears')
  async feeArrears(
    @Query() query: HostelReportQueryDto,
    @Res() res: Response,
    @CurrentUser() user: JwtPayload,
  ) {
    const hostelId = await this.effectiveHostelId(user, query.hostel_id);
    const table = await this.reportsService.feeArrears(hostelId);
    await this.respond(table, query.format, res);
  }

  @Get('leave-audit')
  async leaveAudit(
    @Query() query: HostelReportQueryDto,
    @Res() res: Response,
    @CurrentUser() user: JwtPayload,
  ) {
    const hostelId = await this.effectiveHostelId(user, query.hostel_id);
    const table = await this.reportsService.leaveAudit(
      hostelId,
      query.from,
      query.to,
    );
    await this.respond(table, query.format, res);
  }

  @Get('complaint-sla')
  async complaintSla(
    @Query() query: HostelReportQueryDto,
    @Res() res: Response,
    @CurrentUser() user: JwtPayload,
  ) {
    const hostelId = await this.effectiveHostelId(user, query.hostel_id);
    const table = await this.reportsService.complaintSla(hostelId);
    await this.respond(table, query.format, res);
  }
}
