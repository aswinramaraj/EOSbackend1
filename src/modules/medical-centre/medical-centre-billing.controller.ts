import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentreBillingService } from './medical-centre-billing.service';
import { CreateBillDto } from './dto/create-bill.dto';

@Controller('me/medical-centre-billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreBillingController {
  constructor(private readonly service: MedicalCentreBillingService) {}

  /** GET /api/v1/me/medical-centre-billing/services — the fixed service-charge list. */
  @Get('services')
  getServices() {
    return this.service.getServices();
  }

  /** GET /api/v1/me/medical-centre-billing/history */
  @Get('history')
  getHistory() {
    return this.service.getHistory();
  }

  /** POST /api/v1/me/medical-centre-billing */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  createBill(@Body() dto: CreateBillDto) {
    return this.service.createBill(dto);
  }

  /**
   * GET /api/v1/me/medical-centre-billing/:id/receipt
   * Structured data for the printable receipt. Declared before the
   * parameterised POST below purely for readability; Nest matches on method
   * plus path, so the two never collide.
   */
  @Get(':id/receipt')
  getReceipt(@Param('id', ParseIntPipe) id: number) {
    return this.service.getReceipt(id);
  }

  /** POST /api/v1/me/medical-centre-billing/:id/collect */
  @Post(':id/collect')
  collect(@Param('id', ParseIntPipe) id: number) {
    return this.service.collect(id);
  }
}
