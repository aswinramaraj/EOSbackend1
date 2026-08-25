import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaTeamService } from './media-team.service';
import {
  CreateTeamMemberDto,
  UpdateTeamMemberDto,
} from './dto/media-team.dto';

/** The Media Room's own roster — photographers, editors and crew. */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM, ROLES.ADMIN)
export class MediaTeamController {
  constructor(private readonly service: MediaTeamService) {}

  /** GET /api/v1/me/media-team-members */
  @Get('media-team-members')
  list() {
    return this.service.list();
  }

  /** POST /api/v1/me/media-team-members */
  @Post('media-team-members')
  create(@Body() dto: CreateTeamMemberDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  /** PATCH /api/v1/me/media-team-members/:id */
  @Patch('media-team-members/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTeamMemberDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(id, dto, user.sub);
  }

  /** DELETE /api/v1/me/media-team-members/:id */
  @Delete('media-team-members/:id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.remove(id, user.sub);
  }
}
