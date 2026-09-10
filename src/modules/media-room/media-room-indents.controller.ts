import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomIndentsService } from './media-room-indents.service';
import { CreateIndentDto } from './dto/create-indent.dto';
import { UpdateIndentDto } from './dto/update-indent.dto';

@Controller('me/media-indents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM)
export class MediaRoomIndentsController {
  constructor(private readonly service: MediaRoomIndentsService) {}

  /** GET /api/v1/me/media-indents */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** POST /api/v1/me/media-indents */
  @Post()
  create(@Body() dto: CreateIndentDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  /** PATCH /api/v1/me/media-indents/:id */
  @Patch(':id')
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateIndentDto) {
    return this.service.updateStatus(id, dto);
  }

  /** DELETE /api/v1/me/media-indents/:id */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
