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
import { HostelBlocksService } from './hostel-blocks.service';
import { CreateHostelBlockDto } from './dto/create-hostel-block.dto';
import { UpdateHostelBlockDto } from './dto/update-hostel-block.dto';

/**
 * Admin's "manage hostel blocks" screen. `hostel_blocks` is a real table
 * that already existed (FK-linked from hostel_rooms/hostel_wardens/hostel_goods)
 * but had no create/update/delete anywhere in the app — every reader
 * (Principal's occupancy reports) only ever listed whatever someone had
 * inserted directly via SQL. Writes are Admin-only by design (blocks/floors
 * are structural master data, not something a warden edits); reads are also
 * open to Warden since they need block context (e.g. picking a block when
 * placing a room in their own hostel).
 */
@Controller('hostel/blocks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HostelBlocksController {
  constructor(private readonly service: HostelBlocksService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.ADMIN)
  create(@Body() dto: CreateHostelBlockDto) {
    return this.service.create(dto);
  }

  @Get()
  @Roles(ROLES.ADMIN, ROLES.WARDEN)
  findAll(@Query('hostel_id') hostelId?: string) {
    return this.service.findAll(hostelId ? Number(hostelId) : undefined);
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
    @Body() dto: UpdateHostelBlockDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(ROLES.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
