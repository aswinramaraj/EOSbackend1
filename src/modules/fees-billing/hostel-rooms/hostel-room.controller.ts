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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrismaService } from 'src/prisma/prisma.service';
import { resolveWardenHostelId } from 'src/modules/hostel/common/warden-scope.util';
import { HostelRoomService } from './hostel-room.service';
import { CreateHostelRoomDto } from './dto/create-hostel-room.dto';
import { UpdateHostelRoomDto } from './dto/update-hostel-room.dto';

@Controller('hostel-rooms')
export class HostelRoomController {
  constructor(
    private readonly hostelRoomService: HostelRoomService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /api/v1/hostel-rooms
   *
   * Error responses:
   *  400 VALIDATION_ERROR           – missing/invalid fields
   *  401 UNAUTHORIZED               – missing/invalid access token
   *  403 FORBIDDEN                  – authenticated user is not an admin/warden
   *  404 HOSTEL_NOT_FOUND           – hostel_id does not exist
   *  404 HOSTEL_ROOM_TYPE_NOT_FOUND – room_type_id does not exist
   *  409 HOSTEL_ROOM_EXISTS         – a room with the same room_number already exists in this hostel
   *  500 INTERNAL_ERROR             – unexpected server failure
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.WARDEN)
  create(@Body() dto: CreateHostelRoomDto) {
    return this.hostelRoomService.create(dto);
  }

  /**
   * GET /api/v1/hostel-rooms?hostel_id=
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  // Reads were guarded by JwtAuthGuard alone, so ANY authenticated account
  // — including every student and parent — could list hostel records. The
  // write methods on this controller were always role-guarded; the reads
  // were simply missed. Same roles as the writes.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.WARDEN, ROLES.BILLING)
  async findAll(
    @Query('hostel_id') hostelId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const wardenHostelId = await resolveWardenHostelId(this.prisma, user.sub);
    const effectiveHostelId =
      wardenHostelId ?? (hostelId ? Number(hostelId) : undefined);
    return this.hostelRoomService.findAll(effectiveHostelId);
  }

  /**
   * GET /api/v1/hostel-rooms/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED          – missing/invalid access token
   *  404 HOSTEL_ROOM_NOT_FOUND – no room with the given id
   *  500 INTERNAL_ERROR        – unexpected server failure
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.WARDEN, ROLES.BILLING)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.hostelRoomService.findOne(id);
  }

  /**
   * PUT /api/v1/hostel-rooms/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR           – invalid fields
   *  401 UNAUTHORIZED               – missing/invalid access token
   *  403 FORBIDDEN                  – authenticated user is not an admin/warden
   *  404 HOSTEL_ROOM_NOT_FOUND      – no room with the given id
   *  404 HOSTEL_NOT_FOUND           – hostel_id does not exist
   *  404 HOSTEL_ROOM_TYPE_NOT_FOUND – room_type_id does not exist
   *  409 HOSTEL_ROOM_EXISTS         – another room already uses this room_number in this hostel
   *  500 INTERNAL_ERROR             – unexpected server failure
   */
  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.WARDEN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHostelRoomDto,
  ) {
    return this.hostelRoomService.update(id, dto);
  }

  /**
   * PATCH /api/v1/hostel-rooms/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/hostel-rooms/:id
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.WARDEN)
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHostelRoomDto,
  ) {
    return this.hostelRoomService.update(id, dto);
  }

  /**
   * DELETE /api/v1/hostel-rooms/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED          – missing/invalid access token
   *  403 FORBIDDEN             – authenticated user is not an admin/warden
   *  404 HOSTEL_ROOM_NOT_FOUND – no room with the given id
   *  409 HOSTEL_ROOM_IN_USE    – room is referenced by student_hostel_mapping
   *  500 INTERNAL_ERROR        – unexpected server failure
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.WARDEN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.hostelRoomService.remove(id);
  }
}
