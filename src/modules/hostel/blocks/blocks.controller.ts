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
import { BlocksService } from './blocks.service';
import { CreateBlockDto } from './dto/create-block.dto';
import { UpdateBlockDto } from './dto/update-block.dto';

@Controller('hostel-blocks')
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  /**
   * POST /api/v1/hostel-blocks
   *
   * Error responses:
   *  404 HOSTEL_NOT_FOUND – hostel_id does not exist
   *  409 BLOCK_EXISTS     – a block with this name already exists in this hostel
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
  create(@Body() dto: CreateBlockDto) {
    return this.blocksService.create(dto);
  }

  /** GET /api/v1/hostel-blocks?hostel_id= */
  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Query('hostel_id') hostelId?: string) {
    return this.blocksService.findAll(hostelId ? Number(hostelId) : undefined);
  }

  /**
   * GET /api/v1/hostel-blocks/:id
   *
   * Error responses:
   *  404 BLOCK_NOT_FOUND – no block with the given id
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.blocksService.findOne(id);
  }

  /**
   * PATCH /api/v1/hostel-blocks/:id
   *
   * Error responses:
   *  404 BLOCK_NOT_FOUND  – no block with the given id
   *  404 HOSTEL_NOT_FOUND – hostel_id does not exist
   *  409 BLOCK_EXISTS     – another block already uses this name in this hostel
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBlockDto) {
    return this.blocksService.update(id, dto);
  }

  /**
   * DELETE /api/v1/hostel-blocks/:id
   *
   * Error responses:
   *  404 BLOCK_NOT_FOUND – no block with the given id
   *  409 BLOCK_IN_USE    – block still has rooms or wardens assigned
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.blocksService.remove(id);
  }
}
