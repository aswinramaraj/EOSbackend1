import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomHrPayrollService } from './media-room-hr-payroll.service';
import { CreateHrPayrollRequestDto } from './dto/create-hr-payroll-request.dto';

@Controller('media-room/employee/hr-payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM)
export class MediaRoomHrPayrollController {
  constructor(private readonly service: MediaRoomHrPayrollService) {}

  /** GET /api/v1/media-room/employee/hr-payroll/requests */
  @Get('requests')
  findMine(@CurrentUser() user: JwtPayload) {
    return this.service.findMine(user.sub);
  }

  /** POST /api/v1/media-room/employee/hr-payroll/requests */
  @Post('requests')
  create(@Body() dto: CreateHrPayrollRequestDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }
}
