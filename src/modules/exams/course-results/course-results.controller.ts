import { Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';
import { CourseResultsService } from './course-results.service';
import { ListCourseResultsQueryDto } from './dto/list-course-results-query.dto';

@Controller('course-results')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class CourseResultsController {
  constructor(private readonly service: CourseResultsService) {}

  @Get('stats')
  async getStats(@Query('exam_id', ParseIntPipe) examId: number) {
    const stats = await this.service.getStats(examId);
    return ApiResponse.ok(stats, 'Course result stats fetched successfully.');
  }

  @Get()
  async findAll(@Query() query: ListCourseResultsQueryDto) {
    const rows = await this.service.findAll(query);
    return ApiResponse.ok(rows, 'Course results fetched successfully.');
  }

  @Get(':mappingId/analysis')
  async getAnalysis(@Param('mappingId', ParseIntPipe) mappingId: number) {
    const analysis = await this.service.getAnalysis(mappingId);
    return ApiResponse.ok(analysis, 'Course result analysis fetched successfully.');
  }

  @Post(':mappingId/compute')
  async compute(@Param('mappingId', ParseIntPipe) mappingId: number) {
    const result = await this.service.compute(mappingId);
    return ApiResponse.ok(result, 'Course result computed successfully.');
  }

  @Post(':mappingId/approve')
  async approve(@Param('mappingId', ParseIntPipe) mappingId: number, @CurrentUser() user: JwtPayload) {
    const result = await this.service.approve(mappingId, user.sub);
    return ApiResponse.ok(result, 'Course result approved successfully.');
  }

  @Post(':mappingId/publish')
  async publish(@Param('mappingId', ParseIntPipe) mappingId: number) {
    const result = await this.service.publish(mappingId);
    return ApiResponse.ok(result, 'Course result published successfully.');
  }
}
