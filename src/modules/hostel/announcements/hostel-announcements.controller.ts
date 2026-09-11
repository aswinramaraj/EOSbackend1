import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HostelAnnouncementsService } from './hostel-announcements.service';
import { CreateHostelAnnouncementDto } from './dto/create-hostel-announcement.dto';

@Controller('hostel/announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
// Gate warden deliberately NOT granted: their duty is the gate log
// (check-in/check-out) only, and the gate-warden screens call no
// endpoint on this controller. Hostel residents' complaints, fees,
// leave and attendance are warden/admin business.
@Roles(ROLES.ADMIN, ROLES.WARDEN)
export class HostelAnnouncementsController {
  constructor(private readonly announcementsService: HostelAnnouncementsService) {}

  @Get()
  findAll() {
    return this.announcementsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateHostelAnnouncementDto, @CurrentUser() user: JwtPayload) {
    return this.announcementsService.create(dto, user.sub);
  }
}
