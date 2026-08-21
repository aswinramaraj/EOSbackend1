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
import { ExamTypesService } from './exam-types.service';
import { CreateExamTypeDto } from './dto/create-exam-type.dto';
import { UpdateExamTypeDto } from './dto/update-exam-type.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';

@Controller('exam-types')
export class ExamTypesController {
  constructor(private readonly examTypesService: ExamTypesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async create(@Body() createExamTypeDto: CreateExamTypeDto) {
    const examType = await this.examTypesService.create(createExamTypeDto);
    return ApiResponse.created(examType, 'Exam Type created successfully.');
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.examTypesService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.examTypesService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async update(
    @Param('id') id: string,
    @Body() updateExamTypeDto: UpdateExamTypeDto,
  ) {
    const examType = await this.examTypesService.update(+id, updateExamTypeDto);
    return ApiResponse.ok(examType, 'Exam Type updated successfully.');
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async remove(@Param('id') id: string) {
    await this.examTypesService.remove(+id);
    return ApiResponse.ok(null, 'Exam Type deleted successfully.');
  }
}
