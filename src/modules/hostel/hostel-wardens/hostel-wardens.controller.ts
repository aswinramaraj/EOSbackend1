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
import { HostelWardensService } from './hostel-wardens.service';
import { CreateHostelWardenDto } from './dto/create-hostel-warden.dto';
import { UpdateHostelWardenDto } from './dto/update-hostel-warden.dto';

/**
 * Admin's "assign a warden to a block" screen — writes are Admin-only
 * (same structural-master-data reasoning as hostel/blocks); reads are also
 * open to Warden for context.
 */
@Controller('hostel/wardens')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HostelWardensController {
  constructor(private readonly service: HostelWardensService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(ROLES.ADMIN)
  create(@Body() dto: CreateHostelWardenDto) {
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
    @Body() dto: UpdateHostelWardenDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(ROLES.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
