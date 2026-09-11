import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { FinanceApprovalsService, type ProposalKind } from './approvals.service';
import { DecideProposalDto } from './dto/decide-proposal.dto';
import { requestContext } from '../request-context';

const VALID_KINDS: ProposalKind[] = ['pop', 'sop'];
const VALID_STATUSES = [
  'pending',
  'finance_approved',
  'hod_approved',
  'principal_approved',
  'rejected',
];

@Controller('finance/proposals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceApprovalsController {
  constructor(private readonly service: FinanceApprovalsService) {}

  /**
   * GET /api/v1/finance/proposals/:kind?status=
   *
   * `kind` and `status` come straight off the URL, so both are checked against
   * an allow-list before reaching the query — never interpolated on trust.
   */
  @Get(':kind')
  @Roles(ROLES.FINANCE, ROLES.ADMIN, ROLES.PRINCIPAL)
  list(@Param('kind') kind: string, @Query('status') status?: string) {
    const parsedKind = this.parseKind(kind);
    if (status && !VALID_STATUSES.includes(status)) {
      throw new BadRequestException({
        message: `status must be one of: ${VALID_STATUSES.join(', ')}`,
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return this.service.list(parsedKind, status);
  }

  /**
   * POST /api/v1/finance/proposals/:kind/:id/decision
   *
   * Approving debits the fund, so this is restricted to Finance and Admin —
   * Principal can see the queue but cannot spend from it here.
   */
  @Post(':kind/:id/decision')
  @Roles(ROLES.FINANCE, ROLES.ADMIN)
  decide(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideProposalDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.service.decide(this.parseKind(kind), id, dto, user.sub, requestContext(req));
  }

  private parseKind(kind: string): ProposalKind {
    if (!VALID_KINDS.includes(kind as ProposalKind)) {
      throw new BadRequestException({
        message: "kind must be either 'pop' or 'sop'",
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return kind as ProposalKind;
  }
}
