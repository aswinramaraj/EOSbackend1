import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { MediaRequestsService } from './media-requests.service';
import { CreateMediaRequestDto } from './dto/create-media-request.dto';
import { UpdateMediaRequestDto } from './dto/update-media-request.dto';
import { ListMediaRequestQueryDto } from './dto/list-media-request-query.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MediaRequestsController {
  constructor(private readonly mediaRequestsService: MediaRequestsService) {}

  /** POST /api/v1/media-requests — Faculty / Secretary / Media Room (internal request, no faculty profile needed — same path as Secretary). */
  @Post('media-requests')
  @Roles(ROLES.FACULTY, ROLES.SECRETARY, ROLES.MEDIA_ROOM)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() createMediaRequestDto: CreateMediaRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.mediaRequestsService.create(createMediaRequestDto, user);
  }

  /** GET /api/v1/media-requests — Faculty/Secretary (own only) / Media Room (all). Paginated, filterable. */
  @Get('media-requests')
  @Roles(ROLES.FACULTY, ROLES.SECRETARY, ROLES.MEDIA_ROOM)
  findAll(
    @Query() query: ListMediaRequestQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.mediaRequestsService.findAll(query, user);
  }

  /** GET /api/v1/media-requests/:id — Faculty/Secretary (own only) / Media Room (all). */
  @Get('media-requests/:id')
  @Roles(ROLES.FACULTY, ROLES.SECRETARY, ROLES.MEDIA_ROOM)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.mediaRequestsService.findOne(id, user);
  }

  /** PATCH /api/v1/media-requests/:id — Media Room only. */
  @Patch('media-requests/:id')
  @Roles(ROLES.MEDIA_ROOM)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateMediaRequestDto: UpdateMediaRequestDto,
  ) {
    return this.mediaRequestsService.update(id, updateMediaRequestDto);
  }

  /** DELETE /api/v1/media-requests/:id — Faculty / Secretary / Media Room, own request, only while still 'pending'. */
  @Delete('media-requests/:id')
  @Roles(ROLES.FACULTY, ROLES.SECRETARY, ROLES.MEDIA_ROOM)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.mediaRequestsService.remove(id, user.sub);
  }
}
