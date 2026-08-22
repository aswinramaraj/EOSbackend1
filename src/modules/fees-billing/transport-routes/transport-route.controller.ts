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
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { TransportRouteService } from './transport-route.service';
import { AddTransportStageDto } from './dto/add-transport-stage.dto';
import { CreateTransportRouteDto } from './dto/create-transport-route.dto';
import { UpdateTransportRouteDto } from './dto/update-transport-route.dto';

@Controller('transport-routes')
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransportRouteController {
  constructor(private readonly transportRouteService: TransportRouteService) {}

  /**
   * POST /api/v1/transport-routes
   *
   * Error responses:
   *  400 VALIDATION_ERROR       – missing/invalid name
   *  401 UNAUTHORIZED           – missing/invalid access token
   *  403 FORBIDDEN              – authenticated user is not an admin
   *  409 TRANSPORT_ROUTE_EXISTS – a route with the same name already exists
   *  500 INTERNAL_ERROR         – unexpected server failure
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTransportRouteDto) {
    return this.transportRouteService.create(dto);
  }

  /**
   * POST /api/v1/transport-routes/:id/stages
   *
   * Error responses:
   *  400 VALIDATION_ERROR          – missing/invalid fields
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 TRANSPORT_ROUTE_NOT_FOUND – no route with the given id
   *  409 TRANSPORT_STAGE_EXISTS    – a stage with the same sequence_no already exists for this route
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Post(':id/stages')
  @HttpCode(HttpStatus.CREATED)
  addStage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddTransportStageDto,
  ) {
    return this.transportRouteService.addStage(id, dto);
  }

  /**
   * GET /api/v1/transport-routes
   *
   * Billing additionally allowed (read-only) so the Fee Structures screen can
   * browse real bus routes for transport-fee items — Billing cannot
   * create/update/delete routes, only Admin can.
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  @Roles(ROLES.ADMIN, ROLES.BILLING)
  findAll() {
    return this.transportRouteService.findAll();
  }

  /**
   * GET /api/v1/transport-routes/:id — Billing additionally allowed, see findAll().
   *
   * Error responses:
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 TRANSPORT_ROUTE_NOT_FOUND – no route with the given id
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Get(':id')
  @Roles(ROLES.ADMIN, ROLES.BILLING)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.transportRouteService.findOne(id);
  }

  /**
   * PUT /api/v1/transport-routes/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR          – invalid name
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 TRANSPORT_ROUTE_NOT_FOUND – no route with the given id
   *  409 TRANSPORT_ROUTE_EXISTS    – another route already uses this name
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTransportRouteDto,
  ) {
    return this.transportRouteService.update(id, dto);
  }

  /**
   * PATCH /api/v1/transport-routes/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/transport-routes/:id
   */
  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTransportRouteDto,
  ) {
    return this.transportRouteService.update(id, dto);
  }

  /**
   * DELETE /api/v1/transport-routes/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 TRANSPORT_ROUTE_NOT_FOUND – no route with the given id
   *  409 TRANSPORT_ROUTE_IN_USE    – route is referenced by transport_stages, buses or student_transport_mapping
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.transportRouteService.remove(id);
  }
}
