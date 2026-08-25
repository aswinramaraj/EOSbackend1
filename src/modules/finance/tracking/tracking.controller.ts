import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { FinanceTrackingService, type OrderKind } from './tracking.service';
import {
  CreateAllotmentDto,
  CreateTrackingDto,
  UpdateAllotmentDto,
  UpdateTrackingDto,
} from './dto/tracking.dto';
import { requestContext } from '../request-context';

@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceTrackingController {
  constructor(private readonly service: FinanceTrackingService) {}

  /**
   * GET /api/v1/finance/tracking/faculty-search?q=
   * Declared before `tracking/:kind` so the literal segment is not captured
   * by the parameterised route.
   */
  @Get('tracking/faculty-search')
  @Roles(ROLES.FINANCE, ROLES.ADMIN)
  searchFaculty(@Query('q') q?: string) {
    return this.service.searchFaculty(q);
  }

  /** GET /api/v1/finance/tracking/:kind — kind is purchase | service. */
  @Get('tracking/:kind')
  @Roles(ROLES.FINANCE, ROLES.ADMIN, ROLES.PRINCIPAL)
  list(@Param('kind') kind: string) {
    return this.service.list(this.parseKind(kind));
  }

  /** POST /api/v1/finance/tracking */
  @Post('tracking')
  @Roles(ROLES.FINANCE, ROLES.ADMIN)
  create(
    @Body() dto: CreateTrackingDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.service.create(dto, user.sub, requestContext(req));
  }

  /** PUT /api/v1/finance/tracking/:id */
  @Put('tracking/:id')
  @Roles(ROLES.FINANCE, ROLES.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTrackingDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.service.update(id, dto, user.sub, requestContext(req));
  }

  /** POST /api/v1/finance/tracking/:id/allotments */
  @Post('tracking/:id/allotments')
  @Roles(ROLES.FINANCE, ROLES.ADMIN)
  allot(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAllotmentDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.service.allot(id, dto, user.sub, requestContext(req));
  }

  /** PUT /api/v1/finance/allotments/:id */
  @Put('allotments/:id')
  @Roles(ROLES.FINANCE, ROLES.ADMIN)
  updateAllotment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAllotmentDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.service.updateAllotment(id, dto, user.sub, requestContext(req));
  }

  /** DELETE /api/v1/finance/allotments/:id */
  @Delete('allotments/:id')
  @Roles(ROLES.FINANCE, ROLES.ADMIN)
  removeAllotment(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.service.removeAllotment(id, user.sub, requestContext(req));
  }

  private parseKind(kind: string): OrderKind {
    if (kind !== 'purchase' && kind !== 'service') {
      throw new BadRequestException({
        message: "kind must be either 'purchase' or 'service'",
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return kind;
  }
}
