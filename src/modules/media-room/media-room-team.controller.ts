import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomTeamService } from './media-room-team.service';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';

@Controller('me/media-team-members')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM)
export class MediaRoomTeamController {
  constructor(private readonly service: MediaRoomTeamService) {}

  /** GET /api/v1/me/media-team-members */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** GET /api/v1/me/media-team-members/:id */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  /** POST /api/v1/me/media-team-members */
  @Post()
  create(@Body() dto: CreateTeamMemberDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  /** PATCH /api/v1/me/media-team-members/:id */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTeamMemberDto) {
    return this.service.update(id, dto);
  }

  /** DELETE /api/v1/me/media-team-members/:id */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
