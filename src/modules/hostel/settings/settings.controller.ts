import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HostelSettingsService } from './settings.service';
import { UpdateHostelSettingsDto } from './dto/update-hostel-settings.dto';

@Controller('hostel/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN, ROLES.WARDEN)
export class HostelSettingsController {
  constructor(private readonly settingsService: HostelSettingsService) {}

  @Get()
  get() {
    return this.settingsService.get();
  }

  @Patch()
  update(@Body() dto: UpdateHostelSettingsDto) {
    return this.settingsService.update(dto);
  }
}
