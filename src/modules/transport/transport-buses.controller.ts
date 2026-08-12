import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { TransportBusesService } from './transport-buses.service';
import { TransportBusWriteService } from './transport-bus-write.service';
import { ListBusesQueryDto } from './dto/list-buses-query.dto';
import { CreateBusDto } from './dto/create-bus.dto';

@Controller('me/buses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.TRANSPORT)
export class TransportBusesController {
  constructor(
    private readonly service: TransportBusesService,
    private readonly writeService: TransportBusWriteService,
  ) {}

  /** GET /api/v1/me/buses?status=&search= — fleet list for the transport office. */
  @Get()
  findAll(@Query() query: ListBusesQueryDto) {
    return this.service.findAll(query);
  }

  /** POST /api/v1/me/buses — add a vehicle to the register. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateBusDto) {
    return this.writeService.create(dto);
  }
}
