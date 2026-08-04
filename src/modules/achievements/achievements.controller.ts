import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AchievementsService } from './achievements.service';
import { CreateAchievementDto } from './dto/create-achievement.dto';
import { UpdateAchievementDto } from './dto/update-achievement.dto';
import { ListAchievementsQueryDto } from './dto/list-achievements-query.dto';
import { AchievementMediaItemDto } from './dto/achievement-media-item.dto';
import { CreateAchievementCommentDto } from './dto/create-achievement-comment.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

/**
 * Department achievement posts. Posting/editing/deleting an achievement or
 * its media is restricted to Secretary, Media Room, and Admin (oversight).
 * Reading and commenting has no @Roles() — any authenticated user may.
 */
@Controller('department-achievements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AchievementsController {
  constructor(private readonly achievementsService: AchievementsService) {}

  @Post()
  @Roles(ROLES.SECRETARY, ROLES.MEDIA_ROOM, ROLES.ADMIN)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAchievementDto) {
    return this.achievementsService.create(user, dto);
  }

  @Get()
  findAll(@Query() query: ListAchievementsQueryDto) {
    return this.achievementsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.achievementsService.findOne(id);
  }

  @Patch(':id')
  @Roles(ROLES.SECRETARY, ROLES.MEDIA_ROOM, ROLES.ADMIN)
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAchievementDto,
  ) {
    return this.achievementsService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(ROLES.SECRETARY, ROLES.MEDIA_ROOM, ROLES.ADMIN)
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.achievementsService.remove(user, id);
  }

  @Post(':id/media')
  @Roles(ROLES.SECRETARY, ROLES.MEDIA_ROOM, ROLES.ADMIN)
  addMedia(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AchievementMediaItemDto,
  ) {
    return this.achievementsService.addMedia(user, id, dto);
  }

  @Delete(':id/media/:mediaId')
  @Roles(ROLES.SECRETARY, ROLES.MEDIA_ROOM, ROLES.ADMIN)
  removeMedia(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('mediaId', ParseIntPipe) mediaId: number,
  ) {
    return this.achievementsService.removeMedia(user, id, mediaId);
  }

  @Post(':id/comments')
  addComment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAchievementCommentDto,
  ) {
    return this.achievementsService.addComment(user, id, dto);
  }

  @Delete(':id/comments/:commentId')
  removeComment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('commentId', ParseIntPipe) commentId: number,
  ) {
    return this.achievementsService.removeComment(user, id, commentId);
  }
}
