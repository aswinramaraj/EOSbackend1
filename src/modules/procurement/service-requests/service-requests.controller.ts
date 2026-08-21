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
import { FinanceReviewServiceRequestDto } from './dto/finance-review-service-request.dto';

/**
 * Mirrors PurchaseRequestsController exactly - see its own doc comment.
 *
 * Moved off 'me/service-requests' (2026-08-21): that path collided with
 * secretary/service-requests/service-requests.controller.ts, which imports
 * later in app.module.ts and was being silently shadowed by this
 * controller for every caller, even though the simpler Secretary/HoD/
 * Finance/Admin shape (not this HoD+Finance procurement workflow shape) is
 * the one the frontend actually expects at that path. Renamed rather than
 * merged, since these are two genuinely distinct features that happened to
 * share a literal path.
 */
@Controller('me/procurement-service-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServiceRequestsController {
  constructor(private readonly serviceRequestsService: ServiceRequestsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.SECRETARY)
  create(@Body() dto: CreateServiceRequestDto, @CurrentUser() user: JwtPayload) {
    return this.serviceRequestsService.create(dto, user.sub);
  }

  @Get()
  @Roles(ROLES.SECRETARY, ROLES.HOD, ROLES.FINANCE, ROLES.ADMIN)
  findAll(@Query() query: ListServiceRequestsQueryDto, @CurrentUser() user: JwtPayload) {
    return this.serviceRequestsService.findAll(query, user);
  }

  @Get(':id')
  @Roles(ROLES.SECRETARY, ROLES.HOD, ROLES.FINANCE, ROLES.ADMIN)
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
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

  @Patch(':id/finance-review')
  @Roles(ROLES.FINANCE)
  financeReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FinanceReviewServiceRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.serviceRequestsService.financeReview(id, dto, user.sub);
  }

  @Patch(':id/convert')
  @Roles(ROLES.ADMIN)
  convert(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.serviceRequestsService.convert(id, user.sub);
  }
}
