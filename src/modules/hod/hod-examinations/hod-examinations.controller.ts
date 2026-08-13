import {
  Controller,
  Get,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { renderExcel } from 'src/common/utils/report-export.util';
import { HodExaminationsService } from './hod-examinations.service';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * HoD Examinations & Results — HoD only. Class/exam lookups are always
 * re-verified against the caller's own department server-side, so a client
 * can never pull another department's marks grid by tampering with class_id.
 */
@Controller('hod/examinations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodExaminationsController {
  constructor(
    private readonly hodExaminationsService: HodExaminationsService,
  ) {}

  /** GET /api/v1/hod/examinations/filters — batches/classes/exam-types for the filter bar. */
  @Get('filters')
  getFilters(@CurrentUser() user: JwtPayload) {
    return this.hodExaminationsService.getFilters(user.sub);
  }

  /** GET /api/v1/hod/examinations/grid?class_id=&exam_type_id= — paper-wise marks grid. */
  @Get('grid')
  getGrid(
    @CurrentUser() user: JwtPayload,
    @Query('class_id', ParseIntPipe) classId: number,
    @Query('exam_type_id', ParseIntPipe) examTypeId: number,
  ) {
    return this.hodExaminationsService.getGrid(user.sub, classId, examTypeId);
  }

  /** GET /api/v1/hod/examinations/grid/export?class_id=&exam_type_id= — same grid as an Excel download. */
  @Get('grid/export')
  async exportGrid(
    @CurrentUser() user: JwtPayload,
    @Query('class_id', ParseIntPipe) classId: number,
    @Query('exam_type_id', ParseIntPipe) examTypeId: number,
    @Res() res: Response,
  ) {
    const table = await this.hodExaminationsService.exportGrid(
      user.sub,
      classId,
      examTypeId,
    );
    const buffer = await renderExcel(table);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${slugify(table.title)}.xlsx"`,
    });
    res.send(buffer);
  }
}
