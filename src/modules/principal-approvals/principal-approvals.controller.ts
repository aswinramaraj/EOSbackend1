import { Controller, Get, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalApprovalsService } from './principal-approvals.service';

@Controller('principal-approvals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalApprovalsController {
  constructor(private readonly service: PrincipalApprovalsService) {}

  /** GET /principal-approvals/pending — purchase & service proposals HoD has cleared, awaiting Principal. */
  @Get('pending')
  listPending() {
    return this.service.listPending();
  }

  @Patch('purchase/:id/approve')
  approvePurchase(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.approvePurchase(id, user.sub);
  }

  @Patch('purchase/:id/reject')
  rejectPurchase(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.rejectPurchase(id, user.sub);
  }

  @Patch('service/:id/approve')
  approveService(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.approveService(id, user.sub);
  }

  @Patch('service/:id/reject')
  rejectService(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.rejectService(id, user.sub);
  }
}
