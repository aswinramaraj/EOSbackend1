import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { MeAlumniGroupService } from './me-alumni-group.service';
import { MeAlumniMessagesService } from './me-alumni-messages.service';
import { AlumniAnnouncementsService } from './alumni-announcements.service';
import { UpdateAlumniProfileDto } from './dto/update-alumni-profile.dto';
import { CreateAlumniMessageDto } from './dto/create-alumni-message.dto';

/** Alumni self-service: own batch/roster, own profile, own batch's group chat, announcements feed. */
@Controller('me/alumni')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ALUMNI)
export class MeAlumniController {
  constructor(
    private readonly groupService: MeAlumniGroupService,
    private readonly messagesService: MeAlumniMessagesService,
    private readonly announcementsService: AlumniAnnouncementsService,
  ) {}

  @Get('group')
  getGroup(@CurrentUser() user: JwtPayload) {
    return this.groupService.getOwnGroup(user.sub);
  }

  @Put('profile')
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateAlumniProfileDto,
  ) {
    return this.groupService.updateOwnProfile(user.sub, dto);
  }

  @Get('group/messages')
  listMessages(@CurrentUser() user: JwtPayload, @Query() query: PaginationDto) {
    return this.messagesService.listMessages(user.sub, query);
  }

  @Post('group/messages')
  createMessage(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAlumniMessageDto,
  ) {
    return this.messagesService.createMessage(user.sub, dto);
  }

  @Delete('group/messages/:id')
  deleteMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.messagesService.deleteMessage(user.sub, id);
  }

  @Get('announcements')
  listAnnouncements(@Query() query: PaginationDto) {
    return this.announcementsService.listAnnouncements(query);
  }
}
