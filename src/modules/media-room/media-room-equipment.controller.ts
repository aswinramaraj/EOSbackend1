import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomEquipmentService } from './media-room-equipment.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';

@Controller('me/media-equipment')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM)
export class MediaRoomEquipmentController {
  constructor(private readonly service: MediaRoomEquipmentService) {}

  /** GET /api/v1/me/media-equipment */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** GET /api/v1/me/media-equipment/:id — includes movement history. */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  /** POST /api/v1/me/media-equipment */
  @Post()
  create(@Body() dto: CreateEquipmentDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  /** PATCH /api/v1/me/media-equipment/:id */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEquipmentDto, @CurrentUser() user: JwtPayload) {
    return this.service.update(id, dto, user.sub);
  }

  /** DELETE /api/v1/me/media-equipment/:id */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
