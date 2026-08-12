import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { TransportCrewService } from './transport-crew.service';
import { ListCrewQueryDto } from './dto/list-crew-query.dto';

@Controller('me/crew')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.TRANSPORT)
export class TransportCrewController {
  constructor(private readonly service: TransportCrewService) {}

  /** GET /api/v1/me/crew?search= — drivers & attendants assigned to each bus. */
  @Get()
  findAll(@Query() query: ListCrewQueryDto) {
    return this.service.findAll(query.search);
  }
}
