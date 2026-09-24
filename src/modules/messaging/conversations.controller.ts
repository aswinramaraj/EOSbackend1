import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { MessagingService } from './messaging.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { CreateGroupConversationDto } from './dto/create-group-conversation.dto';
import { AddGroupMembersDto } from './dto/add-group-members.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

const MAX_GROUP_IMAGE_BYTES = 5 * 1024 * 1024;

// RolesGuard is a no-op for any route without its own @Roles() decorator (see
// roles.guard.ts's own doc comment) — safe to add class-wide alongside the
// existing JwtAuthGuard without affecting the DM/list/message routes below,
// which stay open to any authenticated role exactly as before.
@Controller('me/messaging')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConversationsController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('conversations')
  listConversations(
    @Query() query: ListConversationsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.listConversations(user.sub, query);
  }

  @Post('conversations')
  createConversation(
    @Body() dto: CreateConversationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.getOrCreateConversation(
      user.sub,
      user.role,
      dto.otherUserId,
    );
  }

  /** POST /me/messaging/conversations/group (Faculty/HoD/Student) — create a
   * group with any active student in the college, not scoped to the
   * caller's own faculty_subject_class_mapping (see
   * MessagingService.assertStudentsEligible). Faculty/HoD add every selected
   * student immediately; a student caller's selections instead become
   * pending group_invite requests (see createGroupConversation's own doc
   * comment) — the role branch lives in the service, not here. */
  @Post('conversations/group')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.STUDENT)
  createGroupConversation(
    @Body() dto: CreateGroupConversationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.createGroupConversation(user.sub, user.role, dto);
  }

  @Get('conversations/:id/messages')
  listMessages(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListMessagesQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.listMessages(user.sub, id, query);
  }

  /** GET /me/messaging/conversations/:id — any current participant (group details view). */
  @Get('conversations/:id')
  getGroupDetails(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.getGroupDetails(user.sub, id);
  }

  /** PATCH /me/messaging/conversations/:id (Faculty/HoD/Student, group owner only — checked inside the service). */
  @Patch('conversations/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.STUDENT)
  updateGroup(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGroupDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.updateGroup(user.sub, id, dto);
  }

  /** DELETE /me/messaging/conversations/:id (Faculty/HoD/Student, group owner only — checked inside the service). */
  @Delete('conversations/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.STUDENT)
  deleteGroup(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.deleteGroup(user.sub, id);
  }

  /** POST /me/messaging/conversations/:id/members (Faculty/HoD/Student, group owner only — checked inside the service; eligibility re-validated server-side, never trusted from the client). Faculty/HoD add immediately; a student owner's targets instead get a pending group_invite (see MessagingService.addGroupMembers). */
  @Post('conversations/:id/members')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.STUDENT)
  addGroupMembers(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddGroupMembersDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.addGroupMembers(user.sub, user.role, id, dto);
  }

  /** DELETE /me/messaging/conversations/:id/members/:userId (Faculty/HoD/Student, group owner only — checked inside the service). */
  @Delete('conversations/:id/members/:userId')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.STUDENT)
  removeGroupMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.removeGroupMember(user.sub, id, userId);
  }

  /** POST /me/messaging/conversations/:id/image (multipart, field "file") (Faculty/HoD/Student, group owner only — checked inside the service). */
  @Post('conversations/:id/image')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.STUDENT)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_GROUP_IMAGE_BYTES } }),
  )
  uploadGroupImage(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({
        message: 'No file was uploaded (expected multipart field "file")',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return this.messaging.uploadGroupImage(user.sub, id, file);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: JwtPayload) {
    const count = await this.messaging.getUnreadCount(user.sub);
    return { count };
  }

  /** PATCH /me/messaging/conversations/:id/pin — any current participant, personal to the caller (see MessagingService.setConversationPinned's own doc comment). */
  @Patch('conversations/:id/pin')
  pinConversation(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.setConversationPinned(user.sub, id, true);
  }

  /** PATCH /me/messaging/conversations/:id/unpin — any current participant, personal to the caller. */
  @Patch('conversations/:id/unpin')
  unpinConversation(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.setConversationPinned(user.sub, id, false);
  }
}
