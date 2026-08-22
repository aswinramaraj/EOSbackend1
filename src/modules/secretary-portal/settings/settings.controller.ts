import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

/** Per-user preferences — Secretary Portal "Settings" screen. Any
 * authenticated role can read/update their OWN preferences (self-scoped
 * by the JWT's own user id, not institution-wide). */
@Controller('me/preferences')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  getMine(@CurrentUser() user: JwtPayload) {
    return this.settingsService.getMine(user.sub);
  }

  @Patch()
  updateMine(@Body() dto: UpdateSettingsDto, @CurrentUser() user: JwtPayload) {
    return this.settingsService.updateMine(user.sub, dto);
  }
}
