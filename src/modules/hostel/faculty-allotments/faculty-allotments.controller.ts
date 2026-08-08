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
import { FacultyAllotmentsService } from './faculty-allotments.service';
import { AssignFacultyAllotmentDto } from './dto/assign-faculty-allotment.dto';
import { ShiftFacultyAllotmentDto } from './dto/shift-faculty-allotment.dto';
import { SearchFacultyAllotmentsDto } from './dto/search-faculty-allotments.dto';

@Controller('hostel-faculty-allotments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
export class FacultyAllotmentsController {
  constructor(
    private readonly facultyAllotmentsService: FacultyAllotmentsService,
  ) {}

  @Get()
  findAll(@Query() query: SearchFacultyAllotmentsDto) {
    return this.facultyAllotmentsService.findAll(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  assign(@Body() dto: AssignFacultyAllotmentDto) {
    return this.facultyAllotmentsService.assign(dto);
  }

  @Patch(':faculty_id/shift')
  shift(
    @Param('faculty_id', ParseIntPipe) facultyId: number,
    @Body() dto: ShiftFacultyAllotmentDto,
  ) {
    return this.facultyAllotmentsService.shift(facultyId, dto);
  }

  @Delete(':faculty_id')
  vacate(@Param('faculty_id', ParseIntPipe) facultyId: number) {
    return this.facultyAllotmentsService.vacate(facultyId);
  }
}
