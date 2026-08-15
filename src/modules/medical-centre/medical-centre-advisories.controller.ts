import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentreAdvisoriesService } from './medical-centre-advisories.service';
import { CreateAdvisoryDto } from './dto/create-advisory.dto';

@Controller('me/medical-centre-advisories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreAdvisoriesController {
  constructor(private readonly advisoriesService: MedicalCentreAdvisoriesService) {}

  @Get()
  findAll() {
    return this.advisoriesService.findAll();
  }

  @Post()
  create(@Body() dto: CreateAdvisoryDto, @CurrentUser() user: JwtPayload) {
    return this.advisoriesService.create(dto, user.sub);
  }
}
