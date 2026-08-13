import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodMyClassCurrentSemesterService } from './hod-my-class-current-semester.service';

@Controller('hod/my-class/current-semester')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodMyClassCurrentSemesterController {
  constructor(
    private readonly hodMyClassCurrentSemesterService: HodMyClassCurrentSemesterService,
  ) {}

  /** GET /api/v1/hod/my-class/current-semester */
  @Get()
  getOverview(@CurrentUser() user: JwtPayload) {
    return this.hodMyClassCurrentSemesterService.getOverview(user.sub);
  }
}
