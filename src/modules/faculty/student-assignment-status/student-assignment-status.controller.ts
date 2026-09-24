import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { StudentAssignmentStatusService } from './student-assignment-status.service';
import { CreateStudentAssignmentStatusDto } from './dto/create-student-assignment-status.dto';
import { UpdateStudentAssignmentStatusDto } from './dto/update-student-assignment-status.dto';
import { ListStudentAssignmentStatusQueryDto } from './dto/list-student-assignment-status-query.dto';

@Controller('student-assignment-status')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentAssignmentStatusController {
  constructor(
    private readonly studentAssignmentStatusService: StudentAssignmentStatusService,
  ) {}

  /**
   * POST /api/v1/student-assignment-status — Faculty/HoD (own assignment).
   * HOD included so an HoD mapped to teach a subject (Switch Account's
   * "Subject Handling Faculty" mode) can mark submissions the same as any
   * other faculty - the service resolves the caller via faculty.user_id and
   * still requires assignments.faculty_id to match, so this never lets an
   * HoD mark another faculty's assignment.
   */
  @Post()
  @Roles(ROLES.FACULTY, ROLES.HOD)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateStudentAssignmentStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentAssignmentStatusService.create(dto, user.sub);
  }

  /** GET /api/v1/student-assignment-status — Faculty/HoD (own assignments) / Student (own records). */
  @Get()
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.STUDENT)
  findAll(
    @Query() query: ListStudentAssignmentStatusQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentAssignmentStatusService.findAll(query, user);
  }

  /** GET /api/v1/student-assignment-status/:id — Faculty/HoD (own assignments) / Student (own record). */
  @Get(':id')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.STUDENT)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentAssignmentStatusService.findOne(id, user);
  }

  /** PATCH /api/v1/student-assignment-status/:id — Faculty/HoD (owner of the assignment). */
  @Patch(':id')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentAssignmentStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentAssignmentStatusService.update(id, dto, user.sub);
  }

  /** DELETE /api/v1/student-assignment-status/:id — Faculty/HoD (owner of the assignment). */
  @Delete(':id')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentAssignmentStatusService.remove(id, user.sub);
  }
}
