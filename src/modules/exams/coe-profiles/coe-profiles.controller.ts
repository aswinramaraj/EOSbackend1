import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { CoeProfilesService } from './coe-profiles.service';
import { UpdateCoeProfileDto } from './dto/update-coe-profile.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ApiResponse, ROLES } from 'src/common';

/** Admin-only: grants/revokes the Senior Controller of Examinations tier. */
@Controller('coe-profiles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class CoeProfilesController {
  constructor(private readonly coeProfilesService: CoeProfilesService) {}

  @Get()
  async findAll() {
    const profiles = await this.coeProfilesService.findAll();
    return ApiResponse.ok(profiles, 'COE profiles fetched successfully.');
  }

  @Patch(':userId')
  async update(
    @Param('userId') userId: string,
    @Body() dto: UpdateCoeProfileDto,
  ) {
    const profile = await this.coeProfilesService.update(+userId, dto);
    return ApiResponse.ok(profile, 'COE profile updated successfully.');
  }
}
