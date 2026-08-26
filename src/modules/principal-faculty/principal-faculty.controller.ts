import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalFacultyService } from './principal-faculty.service';

@Controller('principal-faculty')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL, ROLES.SECRETARY)
export class PrincipalFacultyController {
  constructor(private readonly service: PrincipalFacultyService) {}

  /** GET /principal-faculty/overview — headcount, duty/appraisal/payroll stats, department-wise strength. */
  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }

  /** GET /principal-faculty/coordination?department_id= — real load/duties/mentees/status per faculty, for the Faculty Coordination screen. */
  @Get('coordination')
  getCoordination(@Query('department_id') departmentId?: string) {
    return this.service.getCoordination(departmentId ? Number(departmentId) : undefined);
  }

  /** GET /principal-faculty/:id/profile — full Faculty Profile detail screen. */
  @Get(':id/profile')
  getProfile(@Param('id', ParseIntPipe) id: number) {
    return this.service.getFacultyProfile(id);
  }

  /**
   * GET /principal-faculty/:id/profile/export?format=csv|excel|pdf — the
   * Faculty Profile screen's "Export PDF" button. Same @Res()-and-manual-
   * headers pattern as PrincipalStudentsController.exportProfile() and
   * PrincipalReportsController.scorecard().
   */
  @Get(':id/profile/export')
  async exportProfile(
    @Param('id', ParseIntPipe) id: number,
    @Query('format') format: 'csv' | 'excel' | 'pdf' = 'pdf',
    @Res() res: Response,
  ) {
    const { buffer, contentType, filename } = await this.service.exportFacultyProfile(id, format);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  /** POST /principal-faculty/:id/assign-duty — real write into faculty_committee_roles. */
  @Post(':id/assign-duty')
  assignDuty(@Param('id', ParseIntPipe) id: number, @Body() body: { committee_name: string; role?: string }) {
    return this.service.assignDuty(id, body.committee_name, body.role);
  }
}
