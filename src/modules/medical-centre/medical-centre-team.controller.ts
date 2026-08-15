import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn } from 'class-validator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentreTeamService } from './medical-centre-team.service';

class SetDutyDto {
  @IsBoolean()
  duty!: boolean;
}

class SetStatusDto {
  @IsIn(['active', 'on_leave'])
  status!: 'active' | 'on_leave';
}

@Controller('me/medical-centre-team')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreTeamController {
  constructor(private readonly service: MedicalCentreTeamService) {}

  /** GET /api/v1/me/medical-centre-team */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** GET /api/v1/me/medical-centre-team/:id */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  /** POST /api/v1/me/medical-centre-team/:id/duty */
  @Post(':id/duty')
  setDuty(@Param('id', ParseIntPipe) id: number, @Body() dto: SetDutyDto) {
    return this.service.setDuty(id, dto.duty);
  }

  /** POST /api/v1/me/medical-centre-team/:id/status */
  @Post(':id/status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: SetStatusDto) {
    return this.service.setStatus(id, dto.status);
  }
}
