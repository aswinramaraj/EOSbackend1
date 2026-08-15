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
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN, ROLES.WARDEN)
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
