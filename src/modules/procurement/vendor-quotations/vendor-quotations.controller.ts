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
import { VendorQuotationsService } from './vendor-quotations.service';
import { CreateVendorQuotationDto } from './dto/create-vendor-quotation.dto';
import { UpdateVendorQuotationDto } from './dto/update-vendor-quotation.dto';

@Controller('vendor-quotations')
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class VendorQuotationsController {
  constructor(
    private readonly vendorQuotationsService: VendorQuotationsService,
  ) {}

  /**
   * POST /api/v1/vendor-quotations
   *
   * Error responses:
   *  400 VALIDATION_ERROR – missing/invalid fields
   *  401 UNAUTHORIZED     – missing/invalid access token
   *  403 FORBIDDEN        – authenticated user is not an admin
   *  404 VENDOR_NOT_FOUND – vendor_id does not exist
   *  500 INTERNAL_ERROR   – unexpected server failure
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateVendorQuotationDto) {
    return this.vendorQuotationsService.create(dto);
  }

  /**
   * GET /api/v1/vendor-quotations
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  findAll() {
    return this.vendorQuotationsService.findAll();
  }

  /**
   * GET /api/v1/vendor-quotations/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED               – missing/invalid access token
   *  403 FORBIDDEN                  – authenticated user is not an admin
   *  404 VENDOR_QUOTATION_NOT_FOUND – no quotation with the given id
   *  500 INTERNAL_ERROR             – unexpected server failure
   */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.vendorQuotationsService.findOne(id);
  }

  /**
   * PUT /api/v1/vendor-quotations/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR           – invalid fields
   *  401 UNAUTHORIZED               – missing/invalid access token
   *  403 FORBIDDEN                  – authenticated user is not an admin
   *  404 VENDOR_QUOTATION_NOT_FOUND – no quotation with the given id
   *  404 VENDOR_NOT_FOUND           – vendor_id does not exist
   *  500 INTERNAL_ERROR             – unexpected server failure
   */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVendorQuotationDto,
  ) {
    return this.vendorQuotationsService.update(id, dto);
  }

  /**
   * PATCH /api/v1/vendor-quotations/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/vendor-quotations/:id
   */
  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVendorQuotationDto,
  ) {
    return this.vendorQuotationsService.update(id, dto);
  }

  /**
   * DELETE /api/v1/vendor-quotations/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED               – missing/invalid access token
   *  403 FORBIDDEN                  – authenticated user is not an admin
   *  404 VENDOR_QUOTATION_NOT_FOUND – no quotation with the given id
   *  500 INTERNAL_ERROR             – unexpected server failure
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.vendorQuotationsService.remove(id);
  }
}
