import {
  Body,
  Controller,
  Delete,
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
import { UpdateServiceRequestDto } from './dto/update-service-request.dto';
import { ListServiceRequestQueryDto } from './dto/list-service-request-query.dto';
import { ReviewServiceRequestDto } from './dto/review-service-request.dto';

/**
 * Service Order Proposal (SOP) self-service requests — Secretary Portal.
 * Deliberately separate from procurement/service-indents: that module is an
 * Admin-only, single-item, vendor/Finance/HoD pipeline; this is a
 * self-service, multi-item, single-decision request with no vendor concept.
 * See the schema/impact-analysis discussion for why these aren't merged.
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServiceRequestsController {
  constructor(
    private readonly serviceRequestsService: ServiceRequestsService,
  ) {}

  /** POST /api/v1/me/service-requests — Secretary. */
  @Post('service-requests')
  @Roles(ROLES.SECRETARY)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateServiceRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.serviceRequestsService.create(dto, user.sub);
  }

  /** GET /api/v1/me/service-requests — Secretary (own only) / Admin (all). */
  @Get('service-requests')
  @Roles(ROLES.SECRETARY, ROLES.ADMIN)
  findAll(
    @Query() query: ListServiceRequestQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.serviceRequestsService.findAll(query, user);
  }

  /** GET /api/v1/me/service-requests/:id — Secretary (own only) / Admin (any). */
  @Get('service-requests/:id')
  @Roles(ROLES.SECRETARY, ROLES.ADMIN)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.serviceRequestsService.findOne(id, user);
  }

  /** PATCH /api/v1/me/service-requests/:id — Secretary, own request, only while 'draft'. */
  @Patch('service-requests/:id')
  @Roles(ROLES.SECRETARY)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServiceRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.serviceRequestsService.update(id, dto, user.sub);
  }

  /** POST /api/v1/me/service-requests/:id/submit — Secretary, own request, only while 'draft'. */
  @Post('service-requests/:id/submit')
  @Roles(ROLES.SECRETARY)
  submit(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.serviceRequestsService.submit(id, user.sub);
  }

  /** PATCH /api/v1/me/service-requests/:id/review — Admin only, only while 'pending'. */
  @Patch('service-requests/:id/review')
  @Roles(ROLES.ADMIN)
  review(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewServiceRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.serviceRequestsService.review(id, dto, user.sub);
  }

  /** DELETE /api/v1/me/service-requests/:id — Secretary, own request, only while 'draft'. */
  @Delete('service-requests/:id')
  @Roles(ROLES.SECRETARY)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.serviceRequestsService.remove(id, user.sub);
  }
}
