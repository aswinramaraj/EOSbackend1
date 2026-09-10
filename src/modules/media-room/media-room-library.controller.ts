import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomLibraryService } from './media-room-library.service';
import { RequestLibraryBookDto } from './dto/request-library-book.dto';

@Controller('media-room/employee/library')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM)
export class MediaRoomLibraryController {
  constructor(private readonly service: MediaRoomLibraryService) {}

  /** GET /api/v1/media-room/employee/library */
  @Get()
  findOverview(@CurrentUser() user: JwtPayload) {
    return this.service.findOverview(user.sub);
  }

  /** POST /api/v1/media-room/employee/library/request — self-issues the book to the caller. */
  @Post('request')
  requestBook(@Body() dto: RequestLibraryBookDto, @CurrentUser() user: JwtPayload) {
    return this.service.requestBook(dto.book_id, user.sub);
  }

  /** PATCH /api/v1/media-room/employee/library/:id/renew */
  @Patch(':id/renew')
  renew(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.renew(id, user.sub);
  }
}
