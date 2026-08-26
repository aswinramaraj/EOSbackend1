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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentrePharmacyService } from './medical-centre-pharmacy.service';
import { StockAdjustDto } from './dto/stock-adjust.dto';
import {
  CreateStockItemDto,
  UpdateStockItemDto,
} from './dto/medical-crud.dto';

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

  /** POST /api/v1/me/medical-centre-pharmacy — add a medicine to the stock list. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  createItem(@Body() dto: CreateStockItemDto) {
    return this.service.createItem(dto);
  }

  /** PATCH /api/v1/me/medical-centre-pharmacy/:id — correct a stock line. */
  @Patch(':id')
  updateItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStockItemDto,
  ) {
    return this.service.updateItem(id, dto);
  }

  /** DELETE /api/v1/me/medical-centre-pharmacy/:id */
  @Delete(':id')
  deleteItem(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteItem(id);
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
