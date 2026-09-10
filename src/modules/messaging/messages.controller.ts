import {
  Body,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MessagingService } from './messaging.service';
import { EditMessageDto } from './dto/edit-message.dto';

@Controller('me/messaging/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messaging: MessagingService) {}

  @Patch(':id')
  edit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EditMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.editMessage(user.sub, id, dto);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messaging.deleteMessage(user.sub, id);
  }
}
