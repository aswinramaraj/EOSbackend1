import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalClassroomsService } from './classrooms.service';

/** GET /api/v1/me/principal/facilities/classrooms — Principal only, read-only. */
@Controller('me/principal/facilities/classrooms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalClassroomsController {
  constructor(private readonly classroomsService: PrincipalClassroomsService) {}

  @Get()
  list() {
    return this.classroomsService.list();
  }
}
