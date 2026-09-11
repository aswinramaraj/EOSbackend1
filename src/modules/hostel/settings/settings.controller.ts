import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HostelSettingsService } from './settings.service';
import { UpdateHostelSettingsDto } from './dto/update-hostel-settings.dto';

@Controller('hostel/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
// Gate warden deliberately NOT granted: their duty is the gate log
// (check-in/check-out) only, and the gate-warden screens call no
// endpoint on this controller. Hostel residents' complaints, fees,
// leave and attendance are warden/admin business.
@Roles(ROLES.ADMIN, ROLES.WARDEN)
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
