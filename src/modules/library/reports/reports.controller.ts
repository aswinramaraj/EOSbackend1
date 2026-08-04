import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { LibraryReportsService } from './reports.service';
import { ReportFormat, ReportQueryDto } from './dto/report-query.dto';
import { renderExcel, renderPdf, type ReportTable } from './report-export.util';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Controller('library/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('library', 'admin')
export class LibraryReportsController {
  constructor(private readonly reportsService: LibraryReportsService) {}

  private async respond(
    table: ReportTable,
    format: ReportFormat | undefined,
    res: Response,
  ) {
    if (format === ReportFormat.excel) {
      const buffer = await renderExcel(table);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${slugify(table.title)}.xlsx"`,
      });
      res.send(buffer);
      return;
    }

    if (format === ReportFormat.pdf) {
      const buffer = await renderPdf(table);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${slugify(table.title)}.pdf"`,
      });
      res.send(buffer);
      return;
    }

    // This controller uses @Res() (required to send binary Excel/PDF
    // bodies), which opts the whole handler out of the global
    // TransformInterceptor — so the plain-JSON branch replicates its
    // envelope manually to keep the response shape consistent with every
    // other endpoint in this API.
    res.json({
      success: true,
      message: 'Success',
      data: table,
      timestamp: new Date().toISOString(),
    });
  }

  @Get('inventory')
  async inventory(@Query() query: ReportQueryDto, @Res() res: Response) {
    const table = await this.reportsService.inventory(query.department_id);
    await this.respond(table, query.format, res);
  }

  @Get('issued')
  async issued(@Query() query: ReportQueryDto, @Res() res: Response) {
    const table = await this.reportsService.issued(
      query.from,
      query.to,
      query.department_id,
    );
    await this.respond(table, query.format, res);
  }

  @Get('returned')
  async returned(@Query() query: ReportQueryDto, @Res() res: Response) {
    const table = await this.reportsService.returned(
      query.from,
      query.to,
      query.department_id,
    );
    await this.respond(table, query.format, res);
  }

  @Get('overdue')
  async overdue(@Query() query: ReportQueryDto, @Res() res: Response) {
    const table = await this.reportsService.overdue(query.department_id);
    await this.respond(table, query.format, res);
  }

  @Get('no-dues-clearance')
  async noDuesClearance(@Query() query: ReportQueryDto, @Res() res: Response) {
    const table = await this.reportsService.noDuesClearanceList();
    await this.respond(table, query.format, res);
  }

  @Get('accession-register')
  async accessionRegister(
    @Query() query: ReportQueryDto,
    @Res() res: Response,
  ) {
    const table = await this.reportsService.accessionRegister(
      query.department_id,
    );
    await this.respond(table, query.format, res);
  }
}
