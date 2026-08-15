import { Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentreEquipmentService } from './medical-centre-equipment.service';

@Controller('me/medical-centre-equipment')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreEquipmentController {
  constructor(private readonly service: MedicalCentreEquipmentService) {}

  /** GET /api/v1/me/medical-centre-equipment */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** POST /api/v1/me/medical-centre-equipment/:id/toggle-condition */
  @Post(':id/toggle-condition')
  toggleCondition(@Param('id', ParseIntPipe) id: number) {
    return this.service.toggleCondition(id);
  }
}
