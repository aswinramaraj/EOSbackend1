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
import { ROLES } from 'src/common/constants/roles.constant';
import { TimetableService } from './timetable.service';
import { CreateTimetableDto } from './dto/create-timetable.dto';
import { UpdateTimetableDto } from './dto/update-timetable.dto';
import { ListTimetableQueryDto } from './dto/list-timetable-query.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TimetableController {
  constructor(private readonly timetableService: TimetableService) {}

  /** POST /api/v1/timetable — HoD only. */
  @Post('timetable-slots')
  @Roles(ROLES.HOD)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTimetableDto) {
    return this.timetableService.create(dto);
  }

  /** GET /api/v1/timetable — Admin/HoD/Faculty/Student/Secretary/Academic Coordinator (read-only oversight). Paginated, filterable. */
  @Get('timetable-slots')
  @Roles(
    ROLES.ADMIN,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.STUDENT,
    ROLES.SECRETARY,
    ROLES.ACADEMIC_COORDINATOR,
  )
  findAll(@Query() query: ListTimetableQueryDto) {
    return this.timetableService.findAll(query);
  }

  /** GET /api/v1/timetable/:id — Admin/HoD/Faculty/Student/Secretary/Academic Coordinator (read-only oversight). */
  @Get('timetable-slots/:id')
  @Roles(
    ROLES.ADMIN,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.STUDENT,
    ROLES.SECRETARY,
    ROLES.ACADEMIC_COORDINATOR,
  )
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.timetableService.findOne(id);
  }

  /** PATCH /api/v1/timetable/:id — HoD only. */
  @Patch('timetable-slots/:id')
  @Roles(ROLES.HOD)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTimetableDto,
  ) {
    return this.timetableService.update(id, dto);
  }

  /** DELETE /api/v1/timetable/:id — HoD only. Hard delete (no soft-delete column on this table). */
  @Delete('timetable-slots/:id')
  @Roles(ROLES.HOD)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.timetableService.remove(id);
  }
}
