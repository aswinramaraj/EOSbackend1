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
import { MediaIndentsService } from './media-indents.service';
import { CreateIndentDto, UpdateIndentDto } from './dto/media-indent.dto';

/** Media Room purchase/repair indents. */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM, ROLES.ADMIN)
export class MediaIndentsController {
  constructor(private readonly service: MediaIndentsService) {}

  /** GET /api/v1/me/media-indents */
  @Get('media-indents')
  list() {
    return this.service.list();
  }

  /** POST /api/v1/me/media-indents */
  @Post('media-indents')
  create(@Body() dto: CreateIndentDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  /** PATCH /api/v1/me/media-indents/:id */
  @Patch('media-indents/:id')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIndentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.updateStatus(id, dto, user.sub);
  }

  /** DELETE /api/v1/me/media-indents/:id */
  @Delete('media-indents/:id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.remove(id, user);
  }
}
