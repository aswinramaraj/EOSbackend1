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
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { FeeConcessionService } from './fee-concession.service';
import { CreateFeeConcessionDto } from './dto/create-fee-concession.dto';
import { UpdateFeeConcessionDto } from './dto/update-fee-concession.dto';

@Controller()
@Roles(ROLES.ADMIN, ROLES.BILLING)
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeeConcessionController {
  constructor(private readonly feeConcessionService: FeeConcessionService) {}

  /**
   * GET /api/v1/fee-concessions
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get('fee-concessions')
  findAll() {
    return this.feeConcessionService.findAll();
  }

  /**
   * GET /api/v1/fee-concessions/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated user is not an admin
   *  404 FEE_CONCESSION_NOT_FOUND – no concession with the given id
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Get('fee-concessions/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.feeConcessionService.findOne(id);
  }

  /**
   * GET /api/v1/fee-structures/:id/concessions
   *
   * Error responses:
   *  401 UNAUTHORIZED            – missing/invalid access token
   *  403 FORBIDDEN               – authenticated user is not an admin
   *  404 FEE_STRUCTURE_NOT_FOUND – no fee structure with the given id
   *  500 INTERNAL_ERROR          – unexpected server failure
   */
  @Get('fee-structures/:id/concessions')
  findAllForFeeStructure(@Param('id', ParseIntPipe) id: number) {
    return this.feeConcessionService.findAllForFeeStructure(id);
  }

  /**
   * POST /api/v1/fee-structures/:id/concessions
   *
   * Error responses:
   *  400 VALIDATION_ERROR          – missing/invalid concession_amount
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 FEE_STRUCTURE_NOT_FOUND   – no fee structure with the given id
   *  422 CONCESSION_EXCEEDS_TOTAL  – concession_amount exceeds the total fee structure amount
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Post('fee-structures/:id/concessions')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateFeeConcessionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.feeConcessionService.create(id, dto, user.sub);
  }

  /**
   * PUT /api/v1/fee-concessions/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR          – invalid concession_amount
   *  401 UNAUTHORIZED              – missing/invalid access token
   *  403 FORBIDDEN                 – authenticated user is not an admin
   *  404 FEE_CONCESSION_NOT_FOUND  – no concession with the given id
   *  422 CONCESSION_EXCEEDS_TOTAL  – concession_amount exceeds the total fee structure amount
   *  500 INTERNAL_ERROR            – unexpected server failure
   */
  @Put('fee-concessions/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFeeConcessionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.feeConcessionService.update(id, dto, user.sub);
  }

  /**
   * PATCH /api/v1/fee-concessions/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/fee-concessions/:id
   */
  @Patch('fee-concessions/:id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFeeConcessionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.feeConcessionService.update(id, dto, user.sub);
  }

  /**
   * DELETE /api/v1/fee-concessions/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED             – missing/invalid access token
   *  403 FORBIDDEN                – authenticated user is not an admin
   *  404 FEE_CONCESSION_NOT_FOUND – no concession with the given id
   *  500 INTERNAL_ERROR           – unexpected server failure
   */
  @Delete('fee-concessions/:id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.feeConcessionService.remove(id, user.sub);
  }
}
