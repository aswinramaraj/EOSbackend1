import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomPayslipService } from './media-room-payslip.service';
import { ApplyPayslipDto } from './dto/apply-payslip.dto';

@Controller('media-room/employee/payslip')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM)
export class MediaRoomPayslipController {
  constructor(private readonly service: MediaRoomPayslipService) {}

  /** GET /api/v1/media-room/employee/payslip/history */
  @Get('history')
  findHistory(@CurrentUser() user: JwtPayload) {
    return this.service.findHistory(user.sub);
  }

  /** POST /api/v1/media-room/employee/payslip */
  @Post()
  apply(@Body() dto: ApplyPayslipDto, @CurrentUser() user: JwtPayload) {
    return this.service.apply(dto, user.sub);
  }
}
