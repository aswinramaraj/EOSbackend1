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
import { ExamSubjectMappingService } from './exam-subject-mapping.service';
import { CreateExamSubjectMappingDto } from './dto/create-exam-subject-mapping.dto';
import { UpdateExamSubjectMappingDto } from './dto/update-exam-subject-mapping.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';

@Controller('exam-subject-mapping')
export class ExamSubjectMappingController {
  constructor(
    private readonly examSubjectMappingService: ExamSubjectMappingService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async create(
    @Body() createExamSubjectMappingDto: CreateExamSubjectMappingDto,
  ) {
    const result = await this.examSubjectMappingService.create(
      createExamSubjectMappingDto,
    );
    return ApiResponse.created(result, 'Subjects mapped successfully.');
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.examSubjectMappingService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.examSubjectMappingService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async update(
    @Param('id') id: string,
    @Body() updateExamSubjectMappingDto: UpdateExamSubjectMappingDto,
  ) {
    const mapping = await this.examSubjectMappingService.update(
      +id,
      updateExamSubjectMappingDto,
    );
    return ApiResponse.ok(
      mapping,
      'Exam subject mapping updated successfully.',
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COE)
  async remove(@Param('id') id: string) {
    await this.examSubjectMappingService.remove(+id);
    return ApiResponse.ok(null, 'Exam subject mapping deleted successfully.');
  }
}
