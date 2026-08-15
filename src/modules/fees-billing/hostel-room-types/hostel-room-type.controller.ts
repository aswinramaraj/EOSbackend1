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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HostelRoomTypeService } from './hostel-room-type.service';
import { CreateHostelRoomTypeDto } from './dto/create-hostel-room-type.dto';
import { UpdateHostelRoomTypeDto } from './dto/update-hostel-room-type.dto';

@Controller('hostel-room-types')
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN, ROLES.WARDEN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class HostelRoomTypeController {
  constructor(private readonly hostelRoomTypeService: HostelRoomTypeService) {}

  /**
   * POST /api/v1/hostel-room-types
   *
   * Error responses:
   *  400 VALIDATION_ERROR        – missing/invalid name
   *  401 UNAUTHORIZED            – missing/invalid access token
   *  403 FORBIDDEN               – authenticated user is not an admin
   *  409 HOSTEL_ROOM_TYPE_EXISTS – a room type with the same name already exists
   *  500 INTERNAL_ERROR          – unexpected server failure
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateHostelRoomTypeDto) {
    return this.hostelRoomTypeService.create(dto);
  }

  /**
   * GET /api/v1/hostel-room-types
   *
   * Error responses:
   *  401 UNAUTHORIZED   – missing/invalid access token
   *  403 FORBIDDEN      – authenticated user is not an admin
   *  500 INTERNAL_ERROR – unexpected server failure
   */
  @Get()
  findAll() {
    return this.hostelRoomTypeService.findAll();
  }

  /**
   * GET /api/v1/hostel-room-types/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED               – missing/invalid access token
   *  403 FORBIDDEN                  – authenticated user is not an admin
   *  404 HOSTEL_ROOM_TYPE_NOT_FOUND – no room type with the given id
   *  500 INTERNAL_ERROR             – unexpected server failure
   */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.hostelRoomTypeService.findOne(id);
  }

  /**
   * PUT /api/v1/hostel-room-types/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR           – invalid name
   *  401 UNAUTHORIZED               – missing/invalid access token
   *  403 FORBIDDEN                  – authenticated user is not an admin
   *  404 HOSTEL_ROOM_TYPE_NOT_FOUND – no room type with the given id
   *  409 HOSTEL_ROOM_TYPE_EXISTS    – another room type already uses this name
   *  500 INTERNAL_ERROR             – unexpected server failure
   */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHostelRoomTypeDto,
  ) {
    return this.hostelRoomTypeService.update(id, dto);
  }

  /**
   * PATCH /api/v1/hostel-room-types/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/hostel-room-types/:id
   */
  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHostelRoomTypeDto,
  ) {
    return this.hostelRoomTypeService.update(id, dto);
  }

  /**
   * DELETE /api/v1/hostel-room-types/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED               – missing/invalid access token
   *  403 FORBIDDEN                  – authenticated user is not an admin
   *  404 HOSTEL_ROOM_TYPE_NOT_FOUND – no room type with the given id
   *  409 HOSTEL_ROOM_TYPE_IN_USE    – room type is referenced by hostel_rooms
   *  500 INTERNAL_ERROR             – unexpected server failure
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.hostelRoomTypeService.remove(id);
  }
}
