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
import { MediaEquipmentService } from './media-equipment.service';
import {
  CreateEquipmentDto,
  UpdateEquipmentDto,
} from './dto/media-equipment.dto';

/**
 * Media Room gear inventory. The whole resource is Media-Room-owned; Admin is
 * included for support access, and no other role can read or change it.
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM, ROLES.ADMIN)
export class MediaEquipmentController {
  constructor(private readonly service: MediaEquipmentService) {}

  /** GET /api/v1/me/media-equipment */
  @Get('media-equipment')
  list() {
    return this.service.list();
  }

  /** GET /api/v1/me/media-equipment/:id */
  @Get('media-equipment/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  /** POST /api/v1/me/media-equipment */
  @Post('media-equipment')
  create(@Body() dto: CreateEquipmentDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  /** PATCH /api/v1/me/media-equipment/:id */
  @Patch('media-equipment/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEquipmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(id, dto, user.sub);
  }

  /** DELETE /api/v1/me/media-equipment/:id */
  @Delete('media-equipment/:id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.remove(id, user.sub);
  }
}
