import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { ListSessionsQueryDto } from './dto/list-sessions-query.dto';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { AttendanceSummaryQueryDto } from './dto/attendance-summary-query.dto';

@Controller('sports-admin/sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  // Must be declared before ':id' — otherwise Nest matches "attendance-summary" as an :id param.
  @Get('attendance-summary')
  attendanceSummary(@Query() query: AttendanceSummaryQueryDto) {
    return this.sessionsService.attendanceSummary(query);
  }

  @Get()
  findAll(@Query() query: ListSessionsQueryDto) {
    return this.sessionsService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateSessionDto) {
    return this.sessionsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.sessionsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSessionDto) {
    return this.sessionsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.sessionsService.remove(id);
  }

  @Put(':id/attendance')
  markAttendance(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkAttendanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sessionsService.markAttendance(id, dto, user.sub);
  }

  @Post(':id/mark-all-present')
  markAllPresent(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sessionsService.markAllPresent(id, user.sub);
  }
}
