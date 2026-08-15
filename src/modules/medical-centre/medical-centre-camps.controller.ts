import { Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentreCampsService } from './medical-centre-camps.service';

@Controller('me/medical-centre-camps')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreCampsController {
  constructor(private readonly service: MedicalCentreCampsService) {}

  /** GET /api/v1/me/medical-centre-camps */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** POST /api/v1/me/medical-centre-camps/:id/register-batch */
  @Post(':id/register-batch')
  registerBatch(@Param('id', ParseIntPipe) id: number) {
    return this.service.registerBatch(id, 60);
  }
}
