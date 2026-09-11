import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';
import { AttendanceEligibilityService } from './attendance-eligibility.service';
import { EligibilityQueryDto } from './dto/eligibility-query.dto';
import { CreateCondonationDto } from './dto/create-condonation.dto';
import { ReviewCondonationDto } from './dto/review-condonation.dto';

@Controller('attendance-eligibility')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class AttendanceEligibilityController {
  constructor(private readonly service: AttendanceEligibilityService) {}

  @Get('stats')
  async getStats(@Query('exam_id', ParseIntPipe) examId: number) {
    const stats = await this.service.getStats({ exam_id: examId });
    return ApiResponse.ok(stats, 'Attendance eligibility stats fetched successfully.');
  }

  @Get()
  async findAll(@Query() query: EligibilityQueryDto) {
    const rows = await this.service.findAll(query);
    return ApiResponse.ok(rows, 'Attendance eligibility fetched successfully.');
  }

  @Post('condonation')
  async createCondonation(@Body() dto: CreateCondonationDto) {
    const request = await this.service.createCondonation(dto);
    return ApiResponse.created(request, 'Condonation request recorded successfully.');
  }

  @Patch('condonation/:id')
  async reviewCondonation(@Param('id', ParseIntPipe) id: number, @Body() dto: ReviewCondonationDto, @CurrentUser() user: JwtPayload) {
    const request = await this.service.reviewCondonation(id, dto, user.sub);
    return ApiResponse.ok(request, 'Condonation request reviewed successfully.');
  }
}
