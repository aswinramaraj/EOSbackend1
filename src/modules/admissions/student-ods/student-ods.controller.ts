import {
  Controller,
  Get,
  Patch,
  Param,
  ParseIntPipe,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { StudentOdsService } from './student-ods.service';
import { ListStudentOdQueryDto } from './dto/list-student-od-query.dto';
import { FacultyApproveOdDto } from './dto/faculty-approve-od.dto';
import { HodApproveOdDto } from './dto/hod-approve-od.dto';

@Controller('me')
export class StudentOdsController {
  constructor(private readonly studentOdsService: StudentOdsService) {}

  /**
   * GET /api/v1/me/student-ods — Faculty (mentor's review queue) or HoD
   * (own-department queue — only requests already mentor-approved).
   */
  @Get('student-ods')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.FACULTY, ROLES.HOD)
  findAll(
    @Query() query: ListStudentOdQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentOdsService.findAll(query, user);
  }

  /**
   * PATCH /api/v1/me/student-ods/:id/faculty-approve — Faculty only (the
   * mentor of the requesting team's creator). The mentor gate on the
   * two-stage chain (mentor, then each member's department HoD).
   */
  @Patch('student-ods/:id/faculty-approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.FACULTY)
  facultyApprove(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FacultyApproveOdDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentOdsService.facultyApprove(id, dto, user.sub);
  }

  /**
   * PATCH /api/v1/me/student-ods/:id/hod-approve — HoD only. Final stage,
   * scoped to the HoD's own department's fan-out row(s).
   */
  @Patch('student-ods/:id/hod-approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.HOD)
  hodApprove(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HodApproveOdDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentOdsService.hodApprove(id, dto, user.sub);
  }
}
