import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { TransportNoticesService } from './transport-notices.service';
import { CreateTransportNoticeDto } from './dto/create-transport-notice.dto';

@Controller('me/transport-notices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.TRANSPORT)
export class TransportNoticesController {
  constructor(private readonly service: TransportNoticesService) {}

  /** GET /api/v1/me/transport-notices — latest 20, newest first. */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** POST /api/v1/me/transport-notices — post a new noticeboard entry. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTransportNoticeDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }
}
