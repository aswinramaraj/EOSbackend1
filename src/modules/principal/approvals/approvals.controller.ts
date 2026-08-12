import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { PrincipalApprovalsService } from './approvals.service';
import { ListApprovalsQueryDto } from './dto/list-approvals-query.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';

/** GET/PATCH /api/v1/me/principal/approvals/* — Principal only. */
@Controller('me/principal/approvals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalApprovalsController {
  constructor(private readonly approvalsService: PrincipalApprovalsService) {}

  @Get('summary')
  summary() {
    return this.approvalsService.summary();
  }

  @Get()
  list(@Query() query: ListApprovalsQueryDto) {
    return this.approvalsService.list(query);
  }

  @Patch(':kind/:id')
  decide(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideApprovalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (kind !== 'leave' && kind !== 'od') {
      throw new BadRequestException({
        message: 'kind must be "leave" or "od"',
        errorCode: 'INVALID_KIND',
      });
    }
    return this.approvalsService.decide(kind, id, dto, user.sub);
  }
}
