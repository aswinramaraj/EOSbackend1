import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { ServiceRequestsService } from './service-requests.service';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { ListServiceRequestsQueryDto } from './dto/list-service-requests-query.dto';
import { HodReviewServiceRequestDto } from './dto/hod-review-service-request.dto';

/**
 * Mirrors PurchaseRequestsController exactly - see its own doc comment.
 *
 * Moved off 'me/service-requests' (2026-08-21) because that path collided
 * with secretary/service-requests/service-requests.controller.ts. That
 * prior fix's own doc comment claimed the two were "genuinely distinct
 * features" and kept both — but the secretary-owned module was actually a
 * single Secretary->Admin decision with no HoD or Finance stage at all
 * (confirmed 2026-09-26 by reading its real code and live-testing all three
 * logins), not the "Secretary/HoD/Finance/Admin shape" the comment
 * described. This module — real HoD-then-Finance review over
 * `service_indents`/`service_order_proposals`, the same tables Finance's
 * fund-integrated approval queue (FinanceApprovalsService) uses — is the
 * one real SOP workflow; the secretary-owned module has been retired (see
 * its own former directory's removal). Named `procurement-service-requests`
 * rather than `service-indent-requests` to avoid reading as a near-duplicate
 * of the separate, already-registered `@Controller('service-indents')`
 * route in this same procurement domain.
 *
 * finance-review and convert were removed as dead code (2026-09-26,
 * unreachable from any frontend page) — Finance's real decision now goes
 * through FinanceApprovalsService.decide(), which also places the order,
 * making this module's own weaker duplicate of that logic redundant.
 */
@Controller('me/procurement-service-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServiceRequestsController {
  constructor(
    private readonly serviceRequestsService: ServiceRequestsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.SECRETARY)
  create(
    @Body() dto: CreateServiceRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.serviceRequestsService.create(dto, user.sub, user);
  }

  @Get()
  @Roles(ROLES.SECRETARY, ROLES.HOD, ROLES.FINANCE, ROLES.ADMIN)
  findAll(
    @Query() query: ListServiceRequestsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.serviceRequestsService.findAll(query, user);
  }

  @Get(':id')
  @Roles(ROLES.SECRETARY, ROLES.HOD, ROLES.FINANCE, ROLES.ADMIN)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.serviceRequestsService.findOne(id, user);
  }

  @Patch(':id/hod-review')
  @Roles(ROLES.HOD)
  hodReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HodReviewServiceRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.serviceRequestsService.hodReview(id, dto, user);
  }
}
