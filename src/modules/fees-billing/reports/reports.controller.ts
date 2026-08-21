import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { renderExcel, renderPdf, type ReportTable } from 'src/common/utils/report-export.util';
import { ReportsService } from './reports.service';
import { ExportFormatQueryDto } from './dto/export-format-query.dto';

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Billing Portal → Reports.
 *
 * Real endpoints for the page's 5 report cards (JSON preview + file
 * export). Refund Register/Reconciliation were removed entirely per
 * explicit instruction — no refunds/reconciliation feature exists in this
 * module any more (DB tables dropped, backend/frontend code removed).
 *
 * Daily Collection Summary's columns are the real payment_mode_enum values
 * (cash, card, upi, netbanking, dd, razorpay) — there is no real
 * "cash/online/DD" 3-way taxonomy in the schema, so nothing is grouped
 * into a category that doesn't map back to a real enum value.
 */
@Controller('reports/billing')
@Roles(ROLES.ADMIN, ROLES.BILLING)
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('demand-vs-collection')
  getDemandVsCollection() {
    return this.reportsService.buildDemandVsCollectionTable();
  }

  @Get('demand-vs-collection/export')
  async exportDemandVsCollection(@Query() query: ExportFormatQueryDto, @Res() res: Response) {
    const table = await this.reportsService.buildDemandVsCollectionTable();
    await this.sendReportFile(table, query.format, res);
  }

  @Get('department-collection')
  getDepartmentCollection() {
    return this.reportsService.buildDepartmentCollectionTable();
  }

  @Get('department-collection/export')
  async exportDepartmentCollection(@Query() query: ExportFormatQueryDto, @Res() res: Response) {
    const table = await this.reportsService.buildDepartmentCollectionTable();
    await this.sendReportFile(table, query.format, res);
  }

  @Get('concession-register')
  getConcessionRegister() {
    return this.reportsService.buildConcessionRegisterTable();
  }

  @Get('concession-register/export')
  async exportConcessionRegister(@Query() query: ExportFormatQueryDto, @Res() res: Response) {
    const table = await this.reportsService.buildConcessionRegisterTable();
    await this.sendReportFile(table, query.format, res);
  }

  @Get('education-loan-dd-register')
  getEducationLoanDdRegister() {
    return this.reportsService.buildEducationLoanDdRegisterTable();
  }

  @Get('education-loan-dd-register/export')
  async exportEducationLoanDdRegister(@Query() query: ExportFormatQueryDto, @Res() res: Response) {
    const table = await this.reportsService.buildEducationLoanDdRegisterTable();
    await this.sendReportFile(table, query.format, res);
  }

  @Get('daily-collection-summary')
  getDailyCollectionSummary() {
    return this.reportsService.buildDailyCollectionSummaryTable();
  }

  @Get('daily-collection-summary/export')
  async exportDailyCollectionSummary(@Query() query: ExportFormatQueryDto, @Res() res: Response) {
    const table = await this.reportsService.buildDailyCollectionSummaryTable();
    await this.sendReportFile(table, query.format, res);
  }

  private async sendReportFile(table: ReportTable, format: 'pdf' | 'excel' | undefined, res: Response) {
    const filename = slugify(table.title);

    if (format === 'excel') {
      const buffer = await renderExcel(table);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
      });
      res.send(buffer);
      return;
    }

    const buffer = await renderPdf(table);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}.pdf"`,
    });
    res.send(buffer);
  }
}
