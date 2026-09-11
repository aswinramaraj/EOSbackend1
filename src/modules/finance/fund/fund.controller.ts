import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
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
import { FinanceFundService } from './fund.service';
import { UpsertFinanceFundDto } from './dto/upsert-fund.dto';
import { requestContext } from '../request-context';

/**
 * The Finance fund: the pot of money POP/SOP approvals are paid out of.
 *
 * Write access is deliberately narrower than read access. Only Finance and
 * Admin may create or revise the total; Principal is granted read-only sight
 * of it, since the Principal approves proposals but does not own the budget.
 */
@Controller('finance/fund')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceFundController {
  constructor(private readonly service: FinanceFundService) {}

  /** GET /api/v1/finance/fund */
  @Get()
  @Roles(ROLES.FINANCE, ROLES.ADMIN, ROLES.PRINCIPAL)
  findAll() {
    return this.service.findAll();
  }

  /** GET /api/v1/finance/fund/current — null when none has been created yet. */
  @Get('current')
  @Roles(ROLES.FINANCE, ROLES.ADMIN, ROLES.PRINCIPAL)
  findCurrent() {
    return this.service.findCurrent();
  }

  /** GET /api/v1/finance/fund/:id/ledger */
  @Get(':id/ledger')
  @Roles(ROLES.FINANCE, ROLES.ADMIN, ROLES.PRINCIPAL)
  ledger(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.ledger(
      id,
      limit ? Number.parseInt(limit, 10) || 100 : 100,
      offset ? Number.parseInt(offset, 10) || 0 : 0,
    );
  }

  /** POST /api/v1/finance/fund */
  @Post()
  @Roles(ROLES.FINANCE, ROLES.ADMIN)
  create(
    @Body() dto: UpsertFinanceFundDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.service.create(dto, user.sub, requestContext(req));
  }

  /** PUT /api/v1/finance/fund/:id */
  @Put(':id')
  @Roles(ROLES.FINANCE, ROLES.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertFinanceFundDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.service.update(id, dto, user.sub, requestContext(req));
  }
}
