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
import { HodSopPopService } from './hod-sop-pop.service';

interface DecideBody {
  decision: 'approved' | 'rejected';
  remarks?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hod/sop-pop-requests')
export class HodSopPopController {
  constructor(private readonly sopPop: HodSopPopService) {}

  @Get()
  @Roles(ROLES.HOD)
  getRequests(@CurrentUser() user: JwtPayload) {
    return this.sopPop.getRequests(user);
  }

  @Patch(':kind/:id')
  @Roles(ROLES.HOD)
  decide(
    @CurrentUser() user: JwtPayload,
    @Param('kind') kind: 'sop' | 'pop',
    @Param('id', ParseIntPipe) id: number,
    @Body() body: DecideBody,
  ) {
    return this.sopPop.decide(user, kind, id, body.decision, body.remarks);
  }
}
