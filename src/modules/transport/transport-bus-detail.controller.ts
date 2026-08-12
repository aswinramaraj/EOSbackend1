import { Body, Controller, Get, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { TransportBusDetailService } from './transport-bus-detail.service';
import { TransportBusWriteService } from './transport-bus-write.service';
import { UpdateBusDto } from './dto/update-bus.dto';

@Controller('me/buses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.TRANSPORT)
export class TransportBusDetailController {
  constructor(
    private readonly service: TransportBusDetailService,
    private readonly writeService: TransportBusWriteService,
  ) {}

  /** GET /api/v1/me/buses/:id — full detail drill-down for one bus. */
  @Get(':id')
  getDetail(@Param('id', ParseIntPipe) id: number) {
    return this.service.getDetail(id);
  }

  /** PATCH /api/v1/me/buses/:id — edit a bus record. */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBusDto) {
    return this.writeService.update(id, dto);
  }
}
