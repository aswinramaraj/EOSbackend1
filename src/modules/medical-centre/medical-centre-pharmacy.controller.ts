import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentrePharmacyService } from './medical-centre-pharmacy.service';
import { StockAdjustDto } from './dto/stock-adjust.dto';

@Controller('me/medical-centre-pharmacy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentrePharmacyController {
  constructor(private readonly service: MedicalCentrePharmacyService) {}

  /** GET /api/v1/me/medical-centre-pharmacy */
  @Get()
  getStock() {
    return this.service.getStock();
  }

  /** POST /api/v1/me/medical-centre-pharmacy/:id/dispense */
  @Post(':id/dispense')
  dispense(@Param('id', ParseIntPipe) id: number, @Body() dto: StockAdjustDto) {
    return this.service.dispense(id, dto.quantity ?? 1);
  }

  /** POST /api/v1/me/medical-centre-pharmacy/:id/restock */
  @Post(':id/restock')
  restock(@Param('id', ParseIntPipe) id: number, @Body() dto: StockAdjustDto) {
    return this.service.restock(id, dto.quantity ?? 50);
  }
}
