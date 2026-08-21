import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DrivesService } from './drives.service';
import { CreateDriveDto } from './dto/create-drive.dto';
import { UpdateDriveDto } from './dto/update-drive.dto';
import { ListDrivesQueryDto } from './dto/list-drives-query.dto';
import { CreateDriveApplicationDto } from './dto/create-drive-application.dto';
import { UpdateDriveApplicationStatusDto } from './dto/update-drive-application-status.dto';
import { UpdatePlacementStatusDto } from './dto/update-placement-status.dto';
import { GetPlacementStatsQueryDto } from './dto/get-placement-stats-query.dto';
import {
  ExportReportQueryDto,
  ExportStudentReportQueryDto,
} from './dto/export-report-query.dto';
import { renderExcel, renderPdf, type ReportTable } from './report-export.util';
import { parseIdentifiersFromFile } from './import-parser.util';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { ROLES } from '../../../common/constants/roles.constant';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Placement drive management — created and run by the Placement Cell (per worflow.md),
 * with Admin retaining oversight access.
 */
@Controller('drives')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PLACEMENT, ROLES.ADMIN)
export class DrivesController {
  constructor(private readonly drivesService: DrivesService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateDriveDto) {
    return this.drivesService.create(user, dto);
  }

  @Get()
  findAll(@Query() query: ListDrivesQueryDto) {
    return this.drivesService.findAll(query);
  }

  /** GET /drives/for-calendar — Principal only, every real drive's date for the merged academic calendar. */
  @Get('for-calendar')
  @Roles(ROLES.PRINCIPAL)
  getAllDrivesForCalendar() {
    return this.drivesService.getAllDrivesForCalendar();
  }

  /**
   * GET /drives/department/:departmentId/upcoming — also Principal (any
   * department, via a dropdown - not just Placement Cell/Admin oversight).
   */
  @Get('department/:departmentId/upcoming')
  @Roles(ROLES.PLACEMENT, ROLES.ADMIN, ROLES.PRINCIPAL)
  getUpcomingForDepartment(
    @Param('departmentId', ParseIntPipe) departmentId: number,
  ) {
    return this.drivesService.getUpcomingForDepartment(departmentId);
  }

  /** GET /drives/department/:departmentId/history — also Principal (any department). */
  @Get('department/:departmentId/history')
  @Roles(ROLES.PLACEMENT, ROLES.ADMIN, ROLES.PRINCIPAL)
  getHistoryForDepartment(
    @Param('departmentId', ParseIntPipe) departmentId: number,
  ) {
    return this.drivesService.getHistoryForDepartment(departmentId);
  }

  // Declared before ':id' — Nest/Express match routes in declaration order,
  // and these static paths would otherwise be swallowed by ':id'.
  @Get('placement-stats')
  getPlacementStats(@Query() query: GetPlacementStatsQueryDto) {
    return this.drivesService.getPlacementStats(query.batch_id);
  }

  @Get('offers')
  getOffers() {
    return this.drivesService.getOffers();
  }

  @Get('batches')
  getBatches() {
    return this.drivesService.getBatches();
  }

  @Get('student-report')
  getStudentReport(@Query() query: GetPlacementStatsQueryDto) {
    return this.drivesService.getStudentReport(query.batch_id);
  }

  @Get('report')
  getDriveReport() {
    return this.drivesService.getDriveReport();
  }

  // Declared before 'student-report/:studentId' — otherwise "export" would
  // be swallowed as a (non-numeric, 400-ing) :studentId value.
  @Get('student-report/export')
  async exportStudentReport(
    @Query() query: ExportStudentReportQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const table = await this.drivesService.buildStudentReportTable(
      query.batch_id,
      query.class,
    );
    await this.drivesService.logReportExport(
      user.sub,
      'export_student_report',
      { ...query },
    );
    await this.sendReportFile(table, query.format, res);
  }

  /**
   * GET /api/v1/drives/reports/generated-count
   * Real count of report exports (both kinds below) logged to audit_logs
   * since the start of the current month — backs the Reports page's
   * "Generated this month" tile.
   */
  @Get('reports/generated-count')
  async getReportsGeneratedCount() {
    const count = await this.drivesService.countReportExportsThisMonth();
    return { count };
  }

  @Get('student-report/:studentId')
  getStudentDriveHistory(@Param('studentId', ParseIntPipe) studentId: number) {
    return this.drivesService.getStudentDriveHistory(studentId);
  }

  @Get('reports/export')
  async exportReport(
    @Query() query: ExportReportQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const table = await this.drivesService.buildReportTable(
      query.batch_id,
      query.view ?? 'class',
      query.department,
    );
    await this.drivesService.logReportExport(user.sub, 'export_class_report', {
      ...query,
    });
    await this.sendReportFile(table, query.format, res);
  }

  private async sendReportFile(
    table: ReportTable,
    format: 'pdf' | 'excel' | undefined,
    res: Response,
  ) {
    const filename = slugify(table.title);

    if (format === 'excel') {
      const buffer = await renderExcel(table);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.drivesService.findOne(id);
  }

  // Admin-facing counterpart to the student/parent/mentor/HoD placement-history
  // views (self, /me/children/:id, /me/mentored-students/:id, /me/department-students/:id)
  // — the admin student-profile "Placements" panel calls this exact path, which
  // never existed before (every request 404'd).
  @Get('students/:studentId/history')
  getHistoryForStudentId(@Param('studentId', ParseIntPipe) studentId: number) {
    return this.drivesService.getHistoryForStudentId(studentId);
  }

  // Full profile (identity + all applications + all offers) — powers the
  // Placement Drives student detail page.
  @Get('students/:studentId/profile')
  getStudentProfile(@Param('studentId', ParseIntPipe) studentId: number) {
    return this.drivesService.getStudentProfile(studentId);
  }

  // Placement Officer explicitly records eligibility/opt-out for the
  // Students page's "Eligible this cycle"/"Opted out" tiles — neither is
  // honestly computable from existing data (see query.md #17).
  @Patch('students/:studentId/placement-status')
  updatePlacementStatus(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: UpdatePlacementStatusDto,
  ) {
    return this.drivesService.updatePlacementStatus(studentId, dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDriveDto) {
    return this.drivesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.drivesService.remove(id);
  }

  @Post(':id/applications')
  addApplication(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateDriveApplicationDto,
  ) {
    return this.drivesService.addApplication(id, dto);
  }

  @Post(':id/applications/import')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async importApplications(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const identifiers = await parseIdentifiersFromFile(file);
    if (identifiers.length === 0) {
      throw new BadRequestException(
        'No student IDs or roll numbers found in the file',
      );
    }
    return this.drivesService.importApplications(id, identifiers);
  }

  @Get(':id/applications')
  listApplications(@Param('id', ParseIntPipe) id: number) {
    return this.drivesService.listApplications(id);
  }

  @Patch(':id/applications/:studentId')
  updateApplicationStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: UpdateDriveApplicationStatusDto,
  ) {
    return this.drivesService.updateApplicationStatus(user, id, studentId, dto);
  }

  @Delete(':id/applications/:studentId')
  removeApplication(
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.drivesService.removeApplication(id, studentId);
  }
}
