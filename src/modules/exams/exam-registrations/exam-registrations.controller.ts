import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';
import { ExamRegistrationsService } from './exam-registrations.service';
import { ListExamRegistrationsQueryDto } from './dto/list-exam-registrations-query.dto';
import { CreateExamRegistrationDto } from './dto/create-exam-registration.dto';
import { ReviewExamRegistrationDto } from './dto/review-exam-registration.dto';
import { UpdateFeeStatusDto } from './dto/update-fee-status.dto';

@Controller('exam-registrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class ExamRegistrationsController {
  constructor(private readonly service: ExamRegistrationsService) {}

  @Get('stats')
  async getStats(@Query('exam_id') examId?: string) {
    const stats = await this.service.getStats(examId ? Number(examId) : undefined);
    return ApiResponse.ok(stats, 'Exam registration stats fetched successfully.');
  }

  @Get()
  async findAll(@Query() query: ListExamRegistrationsQueryDto) {
    const registrations = await this.service.findAll(query);
    return ApiResponse.ok(registrations, 'Exam registrations fetched successfully.');
  }

  @Post()
  async create(@Body() dto: CreateExamRegistrationDto) {
    const registration = await this.service.create(dto);
    return ApiResponse.created(registration, 'Student registered successfully.');
  }

  @Patch(':id/review')
  async review(@Param('id', ParseIntPipe) id: number, @Body() dto: ReviewExamRegistrationDto, @CurrentUser() user: JwtPayload) {
    const registration = await this.service.review(id, dto, user.sub);
    return ApiResponse.ok(registration, 'Registration reviewed successfully.');
  }

  @Patch(':id/fee-status')
  async updateFeeStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFeeStatusDto) {
    const registration = await this.service.updateFeeStatus(id, dto);
    return ApiResponse.ok(registration, 'Fee status updated successfully.');
  }
}
