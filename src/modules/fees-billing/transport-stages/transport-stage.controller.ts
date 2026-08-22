import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { TransportStageService } from './transport-stage.service';
import { UpdateTransportStageDto } from './dto/update-transport-stage.dto';

@Controller('transport-stages')
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransportStageController {
  constructor(private readonly transportStageService: TransportStageService) {}

  /**
   * GET /api/v1/transport-stages
   *
   * Billing additionally allowed (read-only) so the Fee Structures screen can
   * show real stop-wise fares for transport-fee items — Billing cannot
   * create/update/delete stages, only Admin can.
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  @Roles(ROLES.ADMIN, ROLES.BILLING)
  findAll() {
    return this.transportStageService.findAll();
  }

  /**
   * GET /api/v1/transport-stages/:id — Billing additionally allowed, see findAll().
   *
   * Error responses:
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 TRANSPORT_STAGE_NOT_FOUND – no stage with the given id
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Get(':id')
  @Roles(ROLES.ADMIN, ROLES.BILLING)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.transportStageService.findOne(id);
  }

  /**
   * PUT /api/v1/transport-stages/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR          – invalid fields
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 TRANSPORT_STAGE_NOT_FOUND – no stage with the given id
   *  409 TRANSPORT_STAGE_EXISTS    – another stage in the same route already uses this sequence_no
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTransportStageDto,
  ) {
    return this.transportStageService.update(id, dto);
  }

  /**
   * PATCH /api/v1/transport-stages/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/transport-stages/:id
   */
  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTransportStageDto,
  ) {
    return this.transportStageService.update(id, dto);
  }

  /**
   * DELETE /api/v1/transport-stages/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 TRANSPORT_STAGE_NOT_FOUND – no stage with the given id
   *  409 TRANSPORT_STAGE_IN_USE    – stage is referenced by student_transport_mapping
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.transportStageService.remove(id);
  }
}
