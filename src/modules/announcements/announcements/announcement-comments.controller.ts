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
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
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
// Deliberately NO @Roles here: commenting is gated by whether the caller can
// SEE the announcement (assertAnnouncementVisible in the service), which is
// the correct control. The old role list excluded STUDENT, PARENT, HR_PAYROLL
// and WARDEN, so the people the Explore feed is FOR could not comment on it,
// while roles on the list could comment on posts never addressed to them.
export class AnnouncementCommentsController {
  constructor(private readonly service: AnnouncementCommentsService) {}

  /** GET /api/v1/announcements/:id/comments */
  @Get(':id/comments')
  findAll(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.findAll(id, user);
  }

  /** POST /api/v1/announcements/:id/comments */
  @Post(':id/comments')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAnnouncementCommentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(id, dto, user);
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
