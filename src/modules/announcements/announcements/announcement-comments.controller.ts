import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { AnnouncementCommentsService } from './announcement-comments.service';
import { CreateAnnouncementCommentDto } from './dto/create-comment.dto';

/**
 * Comment thread under an announcement.
 *
 * Granted to the roles that post or read announcements in a portal — the same
 * set the announcements write routes use — because a thread is only useful to
 * someone who can see the post it hangs from. Deletion is additionally scoped
 * in the service to the comment's author, the announcement's poster, or Admin.
 */
@Controller('announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  ROLES.ADMIN,
  ROLES.PRINCIPAL,
  ROLES.HOD,
  ROLES.FACULTY,
  ROLES.PLACEMENT,
  ROLES.HIGHER_EDUCATION,
  ROLES.EDC_COORDINATOR,
  ROLES.SECRETARY,
  ROLES.BILLING,
  ROLES.FINANCE,
  ROLES.MEDIA_ROOM,
)
export class AnnouncementCommentsController {
  constructor(private readonly service: AnnouncementCommentsService) {}

  /** GET /api/v1/announcements/:id/comments */
  @Get(':id/comments')
  findAll(@Param('id', ParseIntPipe) id: number) {
    return this.service.findAll(id);
  }

  /** POST /api/v1/announcements/:id/comments */
  @Post(':id/comments')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAnnouncementCommentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(id, dto, user.sub);
  }

  /** DELETE /api/v1/announcements/:id/comments/:commentId */
  @Delete(':id/comments/:commentId')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.remove(id, commentId, user);
  }
}
