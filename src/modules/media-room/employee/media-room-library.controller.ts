import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomLibraryService } from './media-room-library.service';

/**
 * Read-only library view for the Media Room's own staff.
 *
 * Only a GET is exposed: issue, renew and return stay with the library
 * counter, which enforces fine and limit checks this screen has no business
 * bypassing.
 */
@Controller('media-room/employee')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM, ROLES.ADMIN)
export class MediaRoomLibraryController {
  constructor(private readonly service: MediaRoomLibraryService) {}

  /** GET /api/v1/media-room/employee/library */
  @Get('library')
  overview(@CurrentUser() user: JwtPayload) {
    return this.service.overview(user.sub);
  }
}
