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
import { ROLES } from 'src/common/constants/roles.constant';
import { StationaryService } from './stationary.service';
import { UpdateStationaryRequestStatusDto } from './dto/update-stationary-request-status.dto';
import { CreateCounterEntryDto } from './dto/create-counter-entry.dto';
import { UpdateStockItemDto } from './dto/update-stock-item.dto';
import { CreateMachineDto, UpdateMachineDto } from './dto/machine.dto';
import { CreatePrintRateDto, UpdatePrintRateDto } from './dto/print-rate.dto';
import { CreateFinishingRateDto, UpdateFinishingRateDto } from './dto/finishing-rate.dto';

/**
 * Vendor-wide view of every stationary/print request, across every
 * requester — deliberately a separate controller/route from
 * StationaryController's `me/stationary-requests` (self-scoped, any staff/
 * student role that can place an order), since this one is NOT self-scoped
 * and must never be reachable by an ordinary requester.
 */
@Controller('stationary-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.STATIONARY, ROLES.ADMIN)
export class StationaryVendorController {
  constructor(private readonly stationaryService: StationaryService) {}

  /** GET /api/v1/stationary-requests?status= */
  @Get()
  findAll(@Query('status') status?: string) {
    return this.stationaryService.listAllRequests(status);
  }

  /** GET /api/v1/stationary-requests/stats — Dashboard page's stat cards. */
  @Get('stats')
  getStats() {
    return this.stationaryService.getDashboardStats();
  }

  /**
   * PATCH /api/v1/stationary-requests/:id/status
   *
   * Error responses:
   *  400 VALIDATION_ERROR / INVALID_WORKFLOW_STATE
   *  401 UNAUTHORIZED, 403 FORBIDDEN
   *  404 STATIONARY_REQUEST_NOT_FOUND
   *  500 INTERNAL_ERROR
   */
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStationaryRequestStatusDto,
  ) {
    return this.stationaryService.updateStatus(id, dto);
  }

  /** POST /api/v1/stationary-requests/counter — logs a walk-in job with no linked account (the design's "Add entry" modal). */
  @Post('counter')
  @HttpCode(HttpStatus.CREATED)
  createCounterEntry(@Body() dto: CreateCounterEntryDto) {
    return this.stationaryService.createCounterEntry(dto);
  }

  /** GET /api/v1/stationary-requests/stock — Dashboard's "Stock alerts" panel. */
  @Get('stock')
  listStock() {
    return this.stationaryService.listStockItems();
  }

  /** PATCH /api/v1/stationary-requests/stock/:id — vendor updates a stock count. */
  @Patch('stock/:id')
  updateStock(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStockItemDto) {
    return this.stationaryService.updateStockItem(id, dto);
  }

  // ── Operations: Printers & Machines ────────────────────────────────────

  /** GET /api/v1/stationary-requests/machines — Operations page's "Printers & Machines" tab. */
  @Get('machines')
  listMachines() {
    return this.stationaryService.listMachines();
  }

  @Post('machines')
  @HttpCode(HttpStatus.CREATED)
  createMachine(@Body() dto: CreateMachineDto) {
    return this.stationaryService.createMachine(dto);
  }

  @Patch('machines/:id')
  updateMachine(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMachineDto) {
    return this.stationaryService.updateMachine(id, dto);
  }

  @Delete('machines/:id')
  deleteMachine(@Param('id', ParseIntPipe) id: number) {
    return this.stationaryService.deleteMachine(id);
  }

  // ── Operations: Price Detail ─────────────────────────────────────────

  /** GET /api/v1/stationary-requests/print-rates — Operations page's "Price Detail" tab, printing rate card. */
  @Get('print-rates')
  listPrintRates() {
    return this.stationaryService.listPrintRates();
  }

  @Post('print-rates')
  @HttpCode(HttpStatus.CREATED)
  createPrintRate(@Body() dto: CreatePrintRateDto) {
    return this.stationaryService.createPrintRate(dto);
  }

  @Patch('print-rates/:id')
  updatePrintRate(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePrintRateDto) {
    return this.stationaryService.updatePrintRate(id, dto);
  }

  @Delete('print-rates/:id')
  deletePrintRate(@Param('id', ParseIntPipe) id: number) {
    return this.stationaryService.deletePrintRate(id);
  }

  /** GET /api/v1/stationary-requests/finishing-rates — Operations page's "Price Detail" tab, binding & finishing list. */
  @Get('finishing-rates')
  listFinishingRates() {
    return this.stationaryService.listFinishingRates();
  }

  @Post('finishing-rates')
  @HttpCode(HttpStatus.CREATED)
  createFinishingRate(@Body() dto: CreateFinishingRateDto) {
    return this.stationaryService.createFinishingRate(dto);
  }

  @Patch('finishing-rates/:id')
  updateFinishingRate(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFinishingRateDto) {
    return this.stationaryService.updateFinishingRate(id, dto);
  }

  @Delete('finishing-rates/:id')
  deleteFinishingRate(@Param('id', ParseIntPipe) id: number) {
    return this.stationaryService.deleteFinishingRate(id);
  }

  // ── Reports ─────────────────────────────────────────────────────────

  /** GET /api/v1/stationary-requests/reports/usage-by-department?from=&to= — defaults to month-to-date. */
  @Get('reports/usage-by-department')
  getUsageByDepartment(@Query('from') from?: string, @Query('to') to?: string) {
    return this.stationaryService.getUsageByDepartment(from, to);
  }

  /** GET /api/v1/stationary-requests/reports/revenue?from=&to= — defaults to month-to-date. */
  @Get('reports/revenue')
  getRevenueReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.stationaryService.getRevenueReport(from, to);
  }
}
