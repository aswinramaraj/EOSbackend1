import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentreAmbulanceService } from './medical-centre-ambulance.service';
import { CreateTripDto } from './dto/create-trip.dto';

@Controller('me/medical-centre-ambulance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreAmbulanceController {
  constructor(private readonly service: MedicalCentreAmbulanceService) {}

  /** GET /api/v1/me/medical-centre-ambulance */
  @Get()
  getAmbulance() {
    return this.service.getAmbulance();
  }

  /** POST /api/v1/me/medical-centre-ambulance/dispatch */
  @Post('dispatch')
  dispatch() {
    return this.service.setStatus('dispatched');
  }

  /** POST /api/v1/me/medical-centre-ambulance/recall */
  @Post('recall')
  recall() {
    return this.service.setStatus('on_call');
  }

  /** POST /api/v1/me/medical-centre-ambulance/trips */
  @Post('trips')
  logTrip(@Body() dto: CreateTripDto) {
    return this.service.logTrip(dto);
  }
}
