import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { MessageRequestsService } from './message-requests.service';
import { SendChatRequestDto } from './dto/send-chat-request.dto';

/**
 * Student-to-student chat requests and student-created-group invitations —
 * every route here is Student-only (Faculty/HoD groups never generate an
 * invitation; they add members immediately, see ConversationsController).
 */
@Controller('me/messaging')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.STUDENT)
export class MessageRequestsController {
  constructor(private readonly requests: MessageRequestsService) {}

  // ─────────────────────── student-to-student chat requests ───────────────────────

  @Post('requests')
  sendChatRequest(
    @Body() dto: SendChatRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.requests.sendChatRequest(user.sub, dto.receiverUserId);
  }

  @Get('requests/incoming')
  listIncoming(@CurrentUser() user: JwtPayload) {
    return this.requests.listIncomingChatRequests(user.sub);
  }

  @Get('requests/sent')
  listSent(@CurrentUser() user: JwtPayload) {
    return this.requests.listSentChatRequests(user.sub);
  }

  @Get('requests/status/:userId')
  relationshipStatus(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.requests.getRelationshipStatus(user.sub, userId);
  }

  @Post('requests/:id/accept')
  acceptChatRequest(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.requests.acceptChatRequest(user.sub, id);
  }

  @Post('requests/:id/reject')
  rejectChatRequest(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.requests.rejectChatRequest(user.sub, id);
  }

  // ─────────────────────── student-created-group invitations ───────────────────────

  @Get('group-invites')
  listGroupInvites(@CurrentUser() user: JwtPayload) {
    return this.requests.listIncomingGroupInvites(user.sub);
  }

  @Post('group-invites/:id/accept')
  acceptGroupInvite(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.requests.acceptGroupInvite(user.sub, id);
  }

  @Post('group-invites/:id/reject')
  rejectGroupInvite(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.requests.rejectGroupInvite(user.sub, id);
  }
}
