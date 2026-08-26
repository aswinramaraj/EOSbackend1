import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';
import { SpecialAdmissionsService } from './special-admissions.service';
import { ListSpecialAdmissionsQueryDto } from './dto/list-special-admissions-query.dto';
import { NotifySpecialAdmissionDto } from './dto/notify-special-admission.dto';

/**
 * COE-facing monitoring for lateral entry and mid-course transfer students —
 * a new, additive read (+ one real write: notify) over tables that already
 * existed (students.admission_type/joined_academic_year, exam_marks,
 * malpractice_incidents, revaluation_requests, notifications). No schema
 * change; doesn't touch the ADMIN-only /students controller.
 */
@Controller('special-admissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class SpecialAdmissionsController {
  constructor(private readonly specialAdmissionsService: SpecialAdmissionsService) {}

  @Get()
  async getList(@Query() query: ListSpecialAdmissionsQueryDto) {
    const result = await this.specialAdmissionsService.getList(query);
    return ApiResponse.ok(result, 'Lateral entry and transfer students fetched successfully.');
  }

  @Post(':studentId/notify')
  async notify(@Param('studentId', ParseIntPipe) studentId: number, @Body() dto: NotifySpecialAdmissionDto) {
    const result = await this.specialAdmissionsService.notify(studentId, dto);
    return ApiResponse.ok(result, 'Notification sent successfully.');
  }
}
