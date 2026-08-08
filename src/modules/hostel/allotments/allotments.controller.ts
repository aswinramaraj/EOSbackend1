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
import { AllotmentsService } from './allotments.service';
import { AssignAllotmentDto } from './dto/assign-allotment.dto';
import { ShiftAllotmentDto } from './dto/shift-allotment.dto';
import { SearchAllotmentsDto } from './dto/search-allotments.dto';

@Controller('hostel-allotments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
export class AllotmentsController {
  constructor(private readonly allotmentsService: AllotmentsService) {}

  @Get()
  findAll(@Query() query: SearchAllotmentsDto) {
    return this.allotmentsService.findAll(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  assign(@Body() dto: AssignAllotmentDto) {
    return this.allotmentsService.assign(dto);
  }

  @Patch(':student_id/shift')
  shift(
    @Param('student_id', ParseIntPipe) studentId: number,
    @Body() dto: ShiftAllotmentDto,
  ) {
    return this.allotmentsService.shift(studentId, dto);
  }

  @Delete(':student_id')
  vacate(@Param('student_id', ParseIntPipe) studentId: number) {
    return this.allotmentsService.vacate(studentId);
  }
}
