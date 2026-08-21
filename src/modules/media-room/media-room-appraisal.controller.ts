import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomAppraisalService } from './media-room-appraisal.service';
import { ApplyAppraisalDto } from './dto/apply-appraisal.dto';

@Controller('media-room/employee/appraisal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM)
export class MediaRoomAppraisalController {
  constructor(private readonly service: MediaRoomAppraisalService) {}

  /** GET /api/v1/media-room/employee/appraisal/criteria */
  @Get('criteria')
  findCriteria() {
    return this.service.findCriteria();
  }

  /** GET /api/v1/media-room/employee/appraisal/history */
  @Get('history')
  findHistory(@CurrentUser() user: JwtPayload) {
    return this.service.findHistory(user.sub);
  }

  /** POST /api/v1/media-room/employee/appraisal */
  @Post()
  apply(@Body() dto: ApplyAppraisalDto, @CurrentUser() user: JwtPayload) {
    return this.service.apply(dto, user.sub);
  }
}
