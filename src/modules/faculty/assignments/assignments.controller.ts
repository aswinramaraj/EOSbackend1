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
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { ListAssignmentQueryDto } from './dto/list-assignment-query.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  /** POST /api/v1/assignments — Faculty only. */
  @Post('assignments')
  @Roles(ROLES.FACULTY)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateAssignmentDto, @CurrentUser() user: JwtPayload) {
    return this.assignmentsService.create(dto, user.sub);
  }

  /** GET /api/v1/assignments — Faculty only (own records). */
  @Get('assignments')
  @Roles(ROLES.FACULTY)
  findAll(
    @Query() query: ListAssignmentQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assignmentsService.findAll(query, user.sub);
  }

  /**
   * GET /api/v1/me/handled-classes — Faculty only. Every (class, subject)
   * the caller is mapped to teach - the first step of the No-Due tile's
   * "select the class you're handling" flow.
   */
  @Get('handled-classes')
  @Roles(ROLES.FACULTY)
  getHandledClasses(@CurrentUser() user: JwtPayload) {
    return this.assignmentsService.getHandledClasses(user.sub);
  }

  /**
   * GET /api/v1/assignments/:id/students — Faculty only (own record).
   * Every student in the assignment's class, each with their current
   * is_submitted state (false/null status_id if nobody has marked them
   * yet, not omitted).
   */
  @Get('assignments/:id/students')
  @Roles(ROLES.FACULTY)
  getAssignmentStudents(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assignmentsService.getAssignmentStudents(id, user.sub);
  }

  /** GET /api/v1/assignments/:id — Faculty only (own record). */
  @Get('assignments/:id')
  @Roles(ROLES.FACULTY)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assignmentsService.findOne(id, user.sub);
  }

  /** PATCH /api/v1/assignments/:id — Faculty only (own record). */
  @Patch('assignments/:id')
  @Roles(ROLES.FACULTY)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAssignmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assignmentsService.update(id, dto, user.sub);
  }

  /** DELETE /api/v1/assignments/:id — Faculty only (own record). */
  @Delete('assignments/:id')
  @Roles(ROLES.FACULTY)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assignmentsService.remove(id, user.sub);
  }
}
