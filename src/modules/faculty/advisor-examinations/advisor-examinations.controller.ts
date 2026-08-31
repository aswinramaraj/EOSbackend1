import { Controller, Get, ParseIntPipe, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { renderExcel } from 'src/common/utils/report-export.util';
import { AdvisorExaminationsService } from './advisor-examinations.service';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Class-advisor's own view of GET /hod/examinations/* — same grid, scoped to the caller's own mentee class(es) via class_mentors instead of a whole department. */
@Controller('me/advisor-examinations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.FACULTY)
export class AdvisorExaminationsController {
  constructor(private readonly examinations: AdvisorExaminationsService) {}

  @Get('filters')
  getFilters(@CurrentUser() user: JwtPayload) {
    return this.examinations.getFilters(user);
  }

  @Get('grid')
  getGrid(
    @CurrentUser() user: JwtPayload,
    @Query('class_id', ParseIntPipe) classId: number,
    @Query('exam_type_id', ParseIntPipe) examTypeId: number,
  ) {
    return this.examinations.getGrid(user, classId, examTypeId);
  }

  @Get('grid/export')
  async exportGrid(
    @CurrentUser() user: JwtPayload,
    @Query('class_id', ParseIntPipe) classId: number,
    @Query('exam_type_id', ParseIntPipe) examTypeId: number,
    @Res() res: Response,
  ) {
    const table = await this.examinations.getGridExportTable(user, classId, examTypeId);
    const buffer = await renderExcel(table);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${slugify(table.title)}.xlsx"`,
      'Content-Length': String(buffer.length),
    });
    res.send(buffer);
  }
}
