import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { SportsAdminMeService } from './me.service';

@Controller('sports-admin/me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class SportsAdminMeController {
  constructor(private readonly meService: SportsAdminMeService) {}

  @Get()
  getMe(@CurrentUser() user: JwtPayload) {
    return this.meService.getMe(user);
  }

  @Get('nav-counts')
  getNavCounts() {
    return this.meService.getNavCounts();
  }
}
