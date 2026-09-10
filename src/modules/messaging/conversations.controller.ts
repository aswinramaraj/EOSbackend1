import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MessagingService } from './messaging.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';

@Controller('me/messaging')
@UseGuards(JwtAuthGuard)
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

  @Get('conversations/:id/messages')
  listMessages(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListMessagesQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.listMessages(user.sub, id, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: JwtPayload) {
    const count = await this.messaging.getUnreadCount(user.sub);
    return { count };
  }
}
