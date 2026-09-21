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

  /** POST /api/v1/student-assignment-status — Faculty only. */
  @Post()
  @Roles(ROLES.FACULTY)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateStudentAssignmentStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentAssignmentStatusService.create(dto, user.sub);
  }

  /** GET /api/v1/student-assignment-status — Faculty (own assignments) / Student (own records). */
  @Get()
  @Roles(ROLES.FACULTY, ROLES.STUDENT)
  findAll(
    @Query() query: ListStudentAssignmentStatusQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentAssignmentStatusService.findAll(query, user);
  }

  /** GET /api/v1/student-assignment-status/:id — Faculty (own assignments) / Student (own record). */
  @Get(':id')
  @Roles(ROLES.FACULTY, ROLES.STUDENT)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentAssignmentStatusService.findOne(id, user);
  }

  /** PATCH /api/v1/student-assignment-status/:id — Faculty or HoD (owner of the assignment, resolved via the caller's own faculty row either way). */
  @Patch(':id')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentAssignmentStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentAssignmentStatusService.update(id, dto, user.sub);
  }

  /** DELETE /api/v1/student-assignment-status/:id — Faculty only (owner of the assignment). */
  @Delete(':id')
  @Roles(ROLES.FACULTY)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.studentAssignmentStatusService.remove(id, user.sub);
  }
}
