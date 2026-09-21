import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { CanteenSettingsService } from './canteen-settings.service';
import { UpdateCanteenSettingsDto } from './dto/update-canteen-settings.dto';

@Controller('canteen-admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.CANTEEN_ADMIN)
export class CanteenSettingsController {
  constructor(private readonly settings: CanteenSettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Patch()
  update(@Body() dto: UpdateCanteenSettingsDto) {
    return this.settings.update(dto);
  }
}
