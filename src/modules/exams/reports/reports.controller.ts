import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ExamReportsService } from './reports.service';
import {
  ExamReportFormat,
  ExamReportQueryDto,
} from './dto/exam-report-query.dto';
import {
  renderCsv,
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

@Controller('exams/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class ExamReportsController {
  constructor(private readonly reportsService: ExamReportsService) {}

  private async respond(
    table: ReportTable,
    format: ExamReportFormat | undefined,
    res: Response,
  ) {
    if (format === ExamReportFormat.excel) {
      const buffer = await renderExcel(table);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${slugify(table.title)}.xlsx"`,
      });
      res.send(buffer);
      return;
    }

    if (format === ExamReportFormat.pdf) {
      const buffer = await renderPdf(table);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${slugify(table.title)}.pdf"`,
      });
      res.send(buffer);
      return;
    }

    if (format === ExamReportFormat.csv) {
      const csv = renderCsv(table);
      res.set({
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${slugify(table.title)}.csv"`,
      });
      res.send(csv);
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

  @Get('examination-schedule')
  async examinationSchedule(
    @Query() query: ExamReportQueryDto,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.examinationSchedule(query.exam_id);
    await this.respond(table, query.format, res);
  }

  @Get('hall-allocation')
  async hallAllocation(
    @Query() query: ExamReportQueryDto,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.hallAllocation(query.exam_id);
    await this.respond(table, query.format, res);
  }

  @Get('seat-allocation')
  async seatAllocation(
    @Query() query: ExamReportQueryDto,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.seatAllocation(query.exam_id);
    await this.respond(table, query.format, res);
  }

  @Get('invigilator-duty')
  async invigilatorDuty(
    @Query() query: ExamReportQueryDto,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.invigilatorDuty(query.exam_id);
    await this.respond(table, query.format, res);
  }

  @Get('malpractice')
  async malpractice(@Query() query: ExamReportQueryDto, @Res() res: Response) {
    const table = await this.reportsService.malpractice(query.exam_id);
    await this.respond(table, query.format, res);
  }

  @Get('result-analysis')
  async resultAnalysis(
    @Query() query: ExamReportQueryDto,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.resultAnalysis(query.exam_id);
    await this.respond(table, query.format, res);
  }

  @Get('rank-holders')
  async rankHolders(@Query() query: ExamReportQueryDto, @Res() res: Response) {
    const table = await this.reportsService.rankHolders(query.exam_id);
    await this.respond(table, query.format, res);
  }

  @Get('revaluation')
  async revaluation(@Query() query: ExamReportQueryDto, @Res() res: Response) {
    const table = await this.reportsService.revaluation(query.exam_id);
    await this.respond(table, query.format, res);
  }
}
