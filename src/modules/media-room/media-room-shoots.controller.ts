import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomShootsService } from './media-room-shoots.service';
import { CreateShootAssignmentDto } from './dto/create-shoot-assignment.dto';
import { UpdateShootAssignmentDto } from './dto/update-shoot-assignment.dto';

@Controller('me/media-shoot-assignments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM)
export class MediaRoomShootsController {
  constructor(private readonly service: MediaRoomShootsService) {}

  /** GET /api/v1/me/media-shoot-assignments */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** POST /api/v1/me/media-shoot-assignments */
  @Post()
  create(@Body() dto: CreateShootAssignmentDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  /** PATCH /api/v1/me/media-shoot-assignments/:id */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateShootAssignmentDto) {
    return this.service.update(id, dto);
  }

  /** DELETE /api/v1/me/media-shoot-assignments/:id */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
