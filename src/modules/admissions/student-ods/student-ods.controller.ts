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

@Controller('me')
export class StudentOdsController {
  constructor(private readonly studentOdsService: StudentOdsService) {}

  /** GET /api/v1/me/student-ods — Faculty only. The mentor's review queue. */
  @Get('student-ods')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.FACULTY)
  findAll(
    @Query() query: ListStudentOdQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentOdsService.findAll(query, user.sub);
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
}
