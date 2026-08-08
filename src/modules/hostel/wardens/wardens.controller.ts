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
import { WardensService } from './wardens.service';
import { CreateWardenDto } from './dto/create-warden.dto';
import { UpdateWardenDto } from './dto/update-warden.dto';

@Controller('hostel-wardens')
export class WardensController {
  constructor(private readonly wardensService: WardensService) {}

  /**
   * POST /api/v1/hostel-wardens
   *
   * Error responses:
   *  404 BLOCK_NOT_FOUND      – block_id does not exist
   *  409 WARDEN_EMP_ID_EXISTS – emp_id already used by another warden
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
  create(@Body() dto: CreateWardenDto) {
    return this.wardensService.create(dto);
  }

  /** GET /api/v1/hostel-wardens?block_id= */
  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Query('block_id') blockId?: string) {
    return this.wardensService.findAll(blockId ? Number(blockId) : undefined);
  }

  /**
   * GET /api/v1/hostel-wardens/:id
   *
   * Error responses:
   *  404 WARDEN_NOT_FOUND – no warden with the given id
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.wardensService.findOne(id);
  }

  /**
   * PATCH /api/v1/hostel-wardens/:id
   *
   * Error responses:
   *  404 WARDEN_NOT_FOUND     – no warden with the given id
   *  404 BLOCK_NOT_FOUND      – block_id does not exist
   *  409 WARDEN_EMP_ID_EXISTS – another warden already uses this employee ID
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWardenDto) {
    return this.wardensService.update(id, dto);
  }

  /**
   * DELETE /api/v1/hostel-wardens/:id
   *
   * Error responses:
   *  404 WARDEN_NOT_FOUND – no warden with the given id
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.wardensService.remove(id);
  }
}
