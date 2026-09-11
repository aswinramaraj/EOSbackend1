import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaShootsService } from './media-shoots.service';
import {
  CreateShootAssignmentDto,
  UpdateShootAssignmentDto,
} from './dto/media-shoot.dto';

/** Shoot scheduling — crew, gear and slot per assignment. */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM, ROLES.ADMIN)
export class MediaShootsController {
  constructor(private readonly service: MediaShootsService) {}

  /** GET /api/v1/me/media-shoot-assignments */
  @Get('media-shoot-assignments')
  list() {
    return this.service.list();
  }

  /** POST /api/v1/me/media-shoot-assignments */
  @Post('media-shoot-assignments')
  create(
    @Body() dto: CreateShootAssignmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(dto, user.sub);
  }

  /** PATCH /api/v1/me/media-shoot-assignments/:id */
  @Patch('media-shoot-assignments/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateShootAssignmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(id, dto, user.sub);
  }

  /** DELETE /api/v1/me/media-shoot-assignments/:id */
  @Delete('media-shoot-assignments/:id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.remove(id, user.sub);
  }
}
