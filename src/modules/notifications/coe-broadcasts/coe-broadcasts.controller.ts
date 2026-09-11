import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';
import { CoeBroadcastsService } from './coe-broadcasts.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { FindBroadcastsQueryDto } from './dto/find-broadcasts-query.dto';

@Controller('coe-broadcasts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class CoeBroadcastsController {
  constructor(private readonly coeBroadcastsService: CoeBroadcastsService) {}

  @Post()
  async create(
    @Body() dto: CreateBroadcastDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const broadcast = await this.coeBroadcastsService.create(dto, user.sub);
    return ApiResponse.created(broadcast, 'Announcement saved successfully.');
  }

  @Get()
  async findAll(@Query() query: FindBroadcastsQueryDto) {
    const broadcasts = await this.coeBroadcastsService.findAll(query);
    return ApiResponse.ok(broadcasts, 'Announcements fetched successfully.');
  }
}
