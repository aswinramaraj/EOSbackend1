// marks.controller.ts
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
import { MarksService } from './marks.service';
import { CreateMarkDto } from './dto/create-mark.dto';
import { UpdateMarkDto } from './dto/update-mark.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';

/**
 * COE-only override/correction surface for exam_marks — the canonical
 * entry path for faculty is `/me/exams/:exam_subject_mapping_id/marks`
 * (src/modules/faculty/exam-marks), which is ownership-checked and
 * class-scoped. This controller exists for COE to create a missing entry
 * or correct one directly; every update here is flagged is_moderated.
 */
@Controller('exam-marks')
export class MarksController {
  constructor(private readonly marksService: MarksService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async create(@Body() createMarkDto: CreateMarkDto) {
    const mark = await this.marksService.create(createMarkDto);
    return ApiResponse.created(mark, 'Marks created successfully.');
  }

  @Get()
  async findAll() {
    const marks = await this.marksService.findAll();
    return ApiResponse.ok(marks, 'Marks fetched successfully.');
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const mark = await this.marksService.findOne(+id);
    return ApiResponse.ok(mark, 'Marks fetched successfully.');
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async update(@Param('id') id: string, @Body() updateMarkDto: UpdateMarkDto) {
    const mark = await this.marksService.update(+id, updateMarkDto);
    return ApiResponse.ok(mark, 'Marks updated successfully.');
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async remove(@Param('id') id: string) {
    await this.marksService.remove(+id);
    return ApiResponse.ok(null, 'Marks deleted successfully.');
  }
}
