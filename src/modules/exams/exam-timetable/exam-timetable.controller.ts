// exam-timetable.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ExamTimetableService } from './exam-timetable.service';
import { CreateExamTimetableDto } from './dto/create-exam-timetable.dto';
import { UpdateExamTimetableDto } from './dto/update-exam-timetable.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';

@Controller('exam-timetable')
export class ExamTimetableController {
  constructor(private readonly examTimetableService: ExamTimetableService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async create(@Body() createExamTimetableDto: CreateExamTimetableDto) {
    const timetable = await this.examTimetableService.create(
      createExamTimetableDto,
    );
    return ApiResponse.created(
      timetable,
      'Exam timetable created successfully.',
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll() {
    const timetables = await this.examTimetableService.findAll();
    return ApiResponse.ok(timetables, 'Exam timetables fetched successfully.');
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id') id: string) {
    const timetable = await this.examTimetableService.findOne(+id);
    return ApiResponse.ok(timetable, 'Exam timetable fetched successfully.');
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async update(
    @Param('id') id: string,
    @Body() updateExamTimetableDto: UpdateExamTimetableDto,
  ) {
    const timetable = await this.examTimetableService.update(
      +id,
      updateExamTimetableDto,
    );
    return ApiResponse.ok(timetable, 'Exam timetable updated successfully.');
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async remove(@Param('id') id: string) {
    await this.examTimetableService.remove(+id);
    return ApiResponse.ok(null, 'Exam timetable deleted successfully.');
  }
}
