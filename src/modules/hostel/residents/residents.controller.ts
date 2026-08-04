import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { ResidentsService } from './residents.service';
import { SearchResidentsDto } from './dto/search-residents.dto';

@Controller('hostel/residents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
export class ResidentsController {
  constructor(private readonly residentsService: ResidentsService) {}

  @Get()
  findAll(@Query() query: SearchResidentsDto) {
    return this.residentsService.findAll(query);
  }
}
