import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BatchesService } from './batches.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { ClassesService } from '../classes/classes.service';

@Controller('batches')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BatchesController {
  constructor(
    private readonly batchesService: BatchesService,
    private readonly classesService: ClassesService,
  ) {}

  @Post()
  @Roles(ROLES.ADMIN)
  create(
    @Body() createBatchDto: CreateBatchDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.batchesService.create(createBatchDto, user.sub);
  }

  @Get()
  findAll() {
    return this.batchesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.batchesService.findOne(+id);
  }

  @Patch(':id')
  @Roles(ROLES.ADMIN)
  update(
    @Param('id') id: string,
    @Body() updateBatchDto: UpdateBatchDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.batchesService.update(+id, updateBatchDto, user.sub);
  }

  @Delete(':id')
  @Roles(ROLES.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.batchesService.remove(+id, user.sub);
  }

  /** POST /batches/:id/promote — Admin only. Bulk-advances every class under this batch to its next semester. */
  @Post(':id/promote')
  @Roles(ROLES.ADMIN)
  promote(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.classesService.promoteBatch(+id, user.sub);
  }
}
