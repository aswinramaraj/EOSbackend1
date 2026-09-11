import { Controller, Get, UseGuards } from '@nestjs/common';
import { HallTicketsService } from './hall-tickets.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { ApiResponse } from 'src/common/dto/api-response.dto';

/** Separate top-level controller (not nested under /exams/:id) purely for the sidebar nav badge's total-tickets-ever-generated count. */
@Controller('hall-tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class HallTicketsSummaryController {
  constructor(private readonly hallTicketsService: HallTicketsService) {}

  @Get('count')
  async count() {
    const total = await this.hallTicketsService.countAll();
    return ApiResponse.ok({ total }, 'Hall ticket count fetched successfully');
  }
}
