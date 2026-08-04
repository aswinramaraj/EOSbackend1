import {
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

@Controller('exams/:id/hall-tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class HallTicketsController {
  constructor(private readonly hallTicketsService: HallTicketsService) {}

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

  @Get(':studentId')
  findOne(
    @Param('id', ParseIntPipe) examId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.hallTicketsService.findOne(examId, studentId);
  }
}
