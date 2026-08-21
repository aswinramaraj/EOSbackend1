import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalHostelService } from './hostel.service';

/** GET /api/v1/me/principal/hostel/* — Principal only, read-only. */
@Controller('me/principal/hostel')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalHostelController {
  constructor(private readonly hostelService: PrincipalHostelService) {}

  @Get('summary')
  summary() {
    return this.hostelService.summary();
  }

  @Get('blocks')
  blocks() {
    return this.hostelService.blocks();
  }

  @Get('room-type-fees')
  roomTypeFees() {
    return this.hostelService.roomTypeFees();
  }
}
