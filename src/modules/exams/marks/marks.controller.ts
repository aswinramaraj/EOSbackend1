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
import { ListMarksQueryDto } from './dto/list-marks-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';

@Controller('exam-marks')
export class MarksController {
  constructor(private readonly marksService: MarksService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.FACULTY)
  async create(@Body() createMarkDto: CreateMarkDto) {
    const mark = await this.marksService.create(createMarkDto);
    return ApiResponse.created(mark, 'Marks created successfully.');
  }

  @Get()
  async findAll(@Query() query: ListMarksQueryDto) {
    const marks = await this.marksService.findAll(query);
    return ApiResponse.ok(marks, 'Marks fetched successfully.');
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const mark = await this.marksService.findOne(+id);
    return ApiResponse.ok(mark, 'Marks fetched successfully.');
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.FACULTY)
  async update(@Param('id') id: string, @Body() updateMarkDto: UpdateMarkDto) {
    const mark = await this.marksService.update(+id, updateMarkDto);
    return ApiResponse.ok(mark, 'Marks updated successfully.');
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.FACULTY)
  async remove(@Param('id') id: string) {
    await this.marksService.remove(+id);
    return ApiResponse.ok(null, 'Marks deleted successfully.');
  }
}
