import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodAppraisalService } from './hod-appraisal.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hod/appraisal-requests')
export class HodAppraisalController {
  constructor(private readonly hodAppraisal: HodAppraisalService) {}

  @Get()
  @Roles(ROLES.HOD)
  getRequests(@CurrentUser() user: JwtPayload) {
    return this.hodAppraisal.getRequests(user);
  }

  @Get(':id')
  @Roles(ROLES.HOD)
  getDetail(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.hodAppraisal.getDetail(user, id);
  }

  @Patch(':id')
  @Roles(ROLES.HOD)
  decide(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { decision: 'approved' | 'rejected' },
  ) {
    return this.hodAppraisal.decide(user, id, body.decision);
  }
}
