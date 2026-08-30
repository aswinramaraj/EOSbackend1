import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';
import { QuestionPapersService } from './question-papers.service';
import { ListQuestionPapersQueryDto } from './dto/list-question-papers-query.dto';
import { UpsertQuestionPaperDto } from './dto/upsert-question-paper.dto';

@Controller('question-papers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class QuestionPapersController {
  constructor(private readonly service: QuestionPapersService) {}

  @Get('stats')
  async getStats(@Query('exam_id') examId?: string) {
    const stats = await this.service.getStats(examId ? Number(examId) : undefined);
    return ApiResponse.ok(stats, 'Question paper stats fetched successfully.');
  }

  @Get('count')
  async count() {
    const total = await this.service.countAll();
    return ApiResponse.ok({ total }, 'Question paper count fetched successfully.');
  }

  @Get()
  async findAll(@Query() query: ListQuestionPapersQueryDto) {
    const rows = await this.service.findAll(query);
    return ApiResponse.ok(rows, 'Question papers fetched successfully.');
  }

  @Post()
  async upsert(@Body() dto: UpsertQuestionPaperDto) {
    const paper = await this.service.upsert(dto);
    return ApiResponse.ok(paper, 'Question paper updated successfully.');
  }

  @Post(':examSubjectMappingId/remind')
  async remind(@Param('examSubjectMappingId', ParseIntPipe) examSubjectMappingId: number) {
    const notification = await this.service.remind(examSubjectMappingId);
    return ApiResponse.created(notification, 'Reminder sent successfully.');
  }
}
