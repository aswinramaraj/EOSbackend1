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
import { ServiceIndentsService } from './service-indents.service';
import { CreateServiceIndentDto } from './dto/create-service-indent.dto';
import { UpdateServiceIndentDto } from './dto/update-service-indent.dto';

@Controller('service-indents')
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServiceIndentsController {
  constructor(private readonly serviceIndentsService: ServiceIndentsService) {}

  /**
   * POST /api/v1/service-indents
   *
   * Error responses:
   *  400 VALIDATION_ERROR     – missing/invalid fields
   *  401 UNAUTHORIZED         – missing/invalid access token
   *  403 FORBIDDEN            – authenticated user is not an admin
   *  404 USER_NOT_FOUND       – requested_by_user_id does not exist
   *  404 DEPARTMENT_NOT_FOUND – department_id does not exist
   *  500 INTERNAL_ERROR       – unexpected server failure
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateServiceIndentDto) {
    return this.serviceIndentsService.create(dto);
  }

  /**
   * GET /api/v1/service-indents
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  findAll() {
    return this.serviceIndentsService.findAll();
  }

  /**
   * GET /api/v1/service-indents/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated user is not an admin
   *  404 SERVICE_INDENT_NOT_FOUND – no indent with the given id
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.serviceIndentsService.findOne(id);
  }

  /**
   * PUT /api/v1/service-indents/:id
   *
   * Only requested_by_user_id, department_id and service_description may be
   * updated here. This endpoint never changes workflow state — status
   * cannot be modified through it.
   *
   * Error responses:
   *  400 VALIDATION_ERROR         – invalid fields
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated user is not an admin
   *  404 SERVICE_INDENT_NOT_FOUND – no indent with the given id
   *  404 USER_NOT_FOUND           – requested_by_user_id does not exist
   *  404 DEPARTMENT_NOT_FOUND     – department_id does not exist
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServiceIndentDto,
  ) {
    return this.serviceIndentsService.update(id, dto);
  }

  /**
   * PATCH /api/v1/service-indents/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one
   * method. Never changes workflow state.
   *
   * Error responses: see PUT /api/v1/service-indents/:id
   */
  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServiceIndentDto,
  ) {
    return this.serviceIndentsService.update(id, dto);
  }

  /**
   * DELETE /api/v1/service-indents/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated user is not an admin
   *  404 SERVICE_INDENT_NOT_FOUND – no indent with the given id
   *  409 SERVICE_INDENT_IN_USE    – indent is referenced by service_order_proposals
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.serviceIndentsService.remove(id);
  }
}
