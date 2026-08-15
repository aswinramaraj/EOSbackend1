import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentreSickroomService } from './medical-centre-sickroom.service';
import { AdmitBedDto } from './dto/admit-bed.dto';

@Controller('me/medical-centre-sickroom')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreSickroomController {
  constructor(private readonly service: MedicalCentreSickroomService) {}

  /** GET /api/v1/me/medical-centre-sickroom — all 6 beds with current occupant, if any. */
  @Get()
  getBeds() {
    return this.service.getBeds();
  }

  /** POST /api/v1/me/medical-centre-sickroom/:bedId/admit */
  @Post(':bedId/admit')
  admit(@Param('bedId', ParseIntPipe) bedId: number, @Body() dto: AdmitBedDto) {
    return this.service.admit(bedId, dto);
  }

  /** POST /api/v1/me/medical-centre-sickroom/:bedId/discharge */
  @Post(':bedId/discharge')
  discharge(@Param('bedId', ParseIntPipe) bedId: number) {
    return this.service.discharge(bedId);
  }
}
