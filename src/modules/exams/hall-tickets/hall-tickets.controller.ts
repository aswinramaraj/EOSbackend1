import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { HallTicketsService } from './hall-tickets.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { ApiResponse } from 'src/common/dto/api-response.dto';
import { ReportMismatchDto } from './dto/report-mismatch.dto';

@Controller('exams/:id/hall-tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class HallTicketsController {
  constructor(private readonly hallTicketsService: HallTicketsService) {}

  @Get()
  async findAllForExam(@Param('id', ParseIntPipe) examId: number) {
    const rows = await this.hallTicketsService.findAllForExam(examId);
    return ApiResponse.ok(rows, 'Hall tickets fetched successfully');
  }

  @Post(':studentId/mismatch')
  async reportMismatch(
    @Param('id', ParseIntPipe) examId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: ReportMismatchDto,
  ) {
    const ticket = await this.hallTicketsService.reportMismatch(examId, studentId, dto.note);
    return ApiResponse.ok(ticket, 'Mismatch reported successfully');
  }

  @Post(':studentId/download')
  async markDownloaded(
    @Param('id', ParseIntPipe) examId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    const ticket = await this.hallTicketsService.markDownloaded(examId, studentId);
    return ApiResponse.ok(ticket, 'Hall ticket marked as downloaded');
  }

  @Post(':studentId')
  @HttpCode(HttpStatus.CREATED)
  async generate(
    @Param('id', ParseIntPipe) examId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    const hallTicket = await this.hallTicketsService.generate(
      examId,
      studentId,
    );
    return ApiResponse.created(
      hallTicket,
      'Hall ticket generated successfully',
    );
  }

  @Get(':studentId/schedule')
  async getSchedule(
    @Param('id', ParseIntPipe) examId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    const schedule = await this.hallTicketsService.getSchedule(examId, studentId);
    return ApiResponse.ok(schedule, 'Schedule fetched successfully');
  }

  @Get(':studentId')
  findOne(
    @Param('id', ParseIntPipe) examId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.hallTicketsService.findOne(examId, studentId);
  }
}
