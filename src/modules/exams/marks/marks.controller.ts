// marks.controller.ts
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
import { MarksService } from './marks.service';
import { CreateMarkDto } from './dto/create-mark.dto';
import { UpdateMarkDto } from './dto/update-mark.dto';
import { ListExamMarksQueryDto } from './dto/list-exam-marks-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';

@Controller('exam-marks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MarksController {
  constructor(private readonly marksService: MarksService) {}

  // COE added alongside FACULTY on the two write routes below (create/update)
  // — the design's Marks entry page has COE typing directly into the
  // external-marks cell, same @Roles()-guard pattern used everywhere else in
  // this codebase. DELETE is untouched (FACULTY only) since removing a mark
  // isn't part of that flow.
  @Post()
  @Roles(ROLES.FACULTY, ROLES.COE)
  async create(@Body() createMarkDto: CreateMarkDto) {
    const mark = await this.marksService.create(createMarkDto);
    return ApiResponse.created(mark, 'Marks created successfully.');
  }

  // Previously had no guard at all and ignored every query param — any caller,
  // authenticated or not, got every mark for every student in the college.
  // The only real consumer (admin student-profile "Examinations & results"
  // panel) always scopes to one student_id; FACULTY kept alongside ADMIN
  // since they already have write access to marks via this same controller.
  // COE added read-only, the same @Roles()-guard pattern used everywhere
  // else in this codebase (e.g. HOD/faculty/HR routes). HOD, PRINCIPAL and
  // SECRETARY added read-only so the shared SubjectMarksTable (student-profile
  // consolidation) can source real per-subject/per-exam-type marks from this
  // one endpoint for every role instead of each building its own query.
  @Get()
  @Roles(ROLES.ADMIN, ROLES.FACULTY, ROLES.COE, ROLES.HOD, ROLES.PRINCIPAL, ROLES.SECRETARY)
  async findAll(@Query() query: ListExamMarksQueryDto) {
    const marks = await this.marksService.findAll(query);
    return ApiResponse.ok(marks, 'Marks fetched successfully.');
  }

  @Get(':id')
  @Roles(ROLES.ADMIN, ROLES.FACULTY, ROLES.COE)
  async findOne(@Param('id') id: string) {
    const mark = await this.marksService.findOne(+id);
    return ApiResponse.ok(mark, 'Marks fetched successfully.');
  }

  @Patch(':id')
  @Roles(ROLES.FACULTY, ROLES.COE)
  async update(@Param('id') id: string, @Body() updateMarkDto: UpdateMarkDto) {
    const mark = await this.marksService.update(+id, updateMarkDto);
    return ApiResponse.ok(mark, 'Marks updated successfully.');
  }

  @Delete(':id')
  @Roles(ROLES.FACULTY)
  async remove(@Param('id') id: string) {
    await this.marksService.remove(+id);
    return ApiResponse.ok(null, 'Marks deleted successfully.');
  }
}
