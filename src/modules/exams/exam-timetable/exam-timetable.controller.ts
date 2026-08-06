// exam-timetable.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ExamTimetableService } from './exam-timetable.service';
import { CreateExamTimetableDto } from './dto/create-exam-timetable.dto';
import { UpdateExamTimetableDto } from './dto/update-exam-timetable.dto';
import { ListExamTimetableQueryDto } from './dto/list-exam-timetable-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';

/** Per-subject slots within a timetable version — see exam-timetable-versions for the draft/publish workflow. */
@Controller('exam-timetable')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class ExamTimetableController {
  constructor(private readonly examTimetableService: ExamTimetableService) {}

  @Post()
  async create(@Body() createExamTimetableDto: CreateExamTimetableDto) {
    const timetable = await this.examTimetableService.create(
      createExamTimetableDto,
    );
    return ApiResponse.created(
      timetable,
      'Exam timetable slot created successfully.',
    );
  }

  @Get()
  async findAll(@Query() query: ListExamTimetableQueryDto) {
    const timetables = await this.examTimetableService.findAll(query);
    return ApiResponse.ok(
      timetables,
      'Exam timetable slots fetched successfully.',
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const timetable = await this.examTimetableService.findOne(+id);
    return ApiResponse.ok(
      timetable,
      'Exam timetable slot fetched successfully.',
    );
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateExamTimetableDto: UpdateExamTimetableDto,
  ) {
    const timetable = await this.examTimetableService.update(
      +id,
      updateExamTimetableDto,
    );
    return ApiResponse.ok(
      timetable,
      'Exam timetable slot updated successfully.',
    );
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.examTimetableService.remove(+id);
    return ApiResponse.ok(null, 'Exam timetable slot deleted successfully.');
  }
}
