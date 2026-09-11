import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';
import { CoeProfileService } from './coe-profile.service';

@Controller('coe-profile')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class CoeProfileController {
  constructor(private readonly coeProfileService: CoeProfileService) {}

  @Get('me')
  async getMine(@CurrentUser() user: JwtPayload) {
    const profile = await this.coeProfileService.getMine(user.sub);
    return ApiResponse.ok(profile, 'COE profile fetched successfully.');
  }
}
