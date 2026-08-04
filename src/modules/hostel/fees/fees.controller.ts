import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HostelFeesService } from './fees.service';
import { SearchHostelFeesDto } from './dto/search-hostel-fees.dto';

@Controller('hostel/fees')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
export class HostelFeesController {
  constructor(private readonly feesService: HostelFeesService) {}

  @Get()
  findAll(@Query() query: SearchHostelFeesDto) {
    return this.feesService.findAll(query);
  }
}
