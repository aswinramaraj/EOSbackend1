import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';
import { ConfidentialAccessLogService } from './confidential-access-log.service';
import { ListConfidentialEventsQueryDto } from './dto/list-confidential-events-query.dto';
import { CreateConfidentialEventDto } from './dto/create-confidential-event.dto';

@Controller('confidential-access-log')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class ConfidentialAccessLogController {
  constructor(private readonly service: ConfidentialAccessLogService) {}

  @Get('stats')
  async getStats() {
    const stats = await this.service.getStats();
    return ApiResponse.ok(stats, 'Confidential access stats fetched successfully.');
  }

  @Get()
  async findAll(@Query() query: ListConfidentialEventsQueryDto) {
    const rows = await this.service.findAll(query);
    return ApiResponse.ok(rows, 'Confidential access events fetched successfully.');
  }

  @Post()
  async create(@Body() dto: CreateConfidentialEventDto, @CurrentUser() user: JwtPayload) {
    const event = await this.service.create(dto, user.sub);
    return ApiResponse.created(event, 'Confidential access event recorded successfully.');
  }
}
