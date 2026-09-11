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
import { ROLES } from 'src/common/constants/roles.constant';
import { HostelFloorsService } from './hostel-floors.service';
import { CreateHostelFloorDto } from './dto/create-hostel-floor.dto';
import { UpdateHostelFloorDto } from './dto/update-hostel-floor.dto';

/** Admin's "manage hostel floors" screen — writes are Admin-only, same reasoning as hostel/blocks; reads also open to Warden. */
@Controller('hostel/floors')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HostelFloorsController {
  constructor(private readonly service: HostelFloorsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.ADMIN)
  create(@Body() dto: CreateHostelFloorDto) {
    return this.service.create(dto);
  }

  @Get()
  @Roles(ROLES.ADMIN, ROLES.WARDEN)
  findAll(@Query('block_id') blockId?: string) {
    return this.service.findAll(blockId ? Number(blockId) : undefined);
  }

  @Get(':id')
  @Roles(ROLES.ADMIN, ROLES.WARDEN)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(ROLES.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHostelFloorDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(ROLES.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
