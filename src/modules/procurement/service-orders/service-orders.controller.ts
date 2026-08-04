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
import { ServiceOrdersService } from './service-orders.service';
import { CreateServiceOrderDto } from './dto/create-service-order.dto';
import { UpdateServiceOrderDto } from './dto/update-service-order.dto';

@Controller('service-orders')
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServiceOrdersController {
  constructor(private readonly serviceOrdersService: ServiceOrdersService) {}

  /**
   * POST /api/v1/service-orders
   *
   * Error responses:
   *  400 VALIDATION_ERROR                 – missing/invalid fields
   *  401 UNAUTHORIZED                     – missing/invalid access token
   *  403 FORBIDDEN                        – authenticated user is not an admin
   *  404 SERVICE_ORDER_PROPOSAL_NOT_FOUND – proposal_id does not exist
   *  404 USER_NOT_FOUND                   – approved_by_user_id does not exist
   *  409 SERVICE_ORDER_PROPOSAL_IN_USE    – proposal_id is already used by another service order
   *  409 SERVICE_ORDER_NUMBER_EXISTS      – so_number already used by another service order
   *  500 INTERNAL_ERROR                   – unexpected server failure
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateServiceOrderDto) {
    return this.serviceOrdersService.create(dto);
  }

  /**
   * GET /api/v1/service-orders
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  findAll() {
    return this.serviceOrdersService.findAll();
  }

  /**
   * GET /api/v1/service-orders/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated user is not an admin
   *  404 SERVICE_ORDER_NOT_FOUND  – no service order with the given id
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.serviceOrdersService.findOne(id);
  }

  /**
   * PUT /api/v1/service-orders/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR                  – invalid fields
   *  401 UNAUTHORIZED                      – missing/invalid access token
   *  403 FORBIDDEN                         – authenticated user is not an admin
   *  404 SERVICE_ORDER_NOT_FOUND           – no service order with the given id
   *  404 SERVICE_ORDER_PROPOSAL_NOT_FOUND  – proposal_id does not exist
   *  404 USER_NOT_FOUND                    – approved_by_user_id does not exist
   *  409 SERVICE_ORDER_PROPOSAL_IN_USE     – proposal_id is already used by another service order
   *  409 SERVICE_ORDER_NUMBER_EXISTS       – so_number already used by another service order
   *  500 INTERNAL_ERROR                    – unexpected server failure
   */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServiceOrderDto,
  ) {
    return this.serviceOrdersService.update(id, dto);
  }

  /**
   * PATCH /api/v1/service-orders/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/service-orders/:id
   */
  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServiceOrderDto,
  ) {
    return this.serviceOrdersService.update(id, dto);
  }

  /**
   * DELETE /api/v1/service-orders/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated user is not an admin
   *  404 SERVICE_ORDER_NOT_FOUND  – no service order with the given id
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.serviceOrdersService.remove(id);
  }
}
