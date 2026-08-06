import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InvigilationAllocationBatchesService } from './invigilation-allocation-batches.service';
import { CreateAllocationBatchDto } from './dto/create-allocation-batch.dto';
import { ListAllocationBatchesQueryDto } from './dto/list-allocation-batches-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SeniorCoeGuard } from 'src/auth/guards/senior-coe.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';

@Controller('invigilation-allocation-batches')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class InvigilationAllocationBatchesController {
  constructor(
    private readonly batchesService: InvigilationAllocationBatchesService,
  ) {}

  @Post()
  async findOrCreate(
    @Body() dto: CreateAllocationBatchDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const batch = await this.batchesService.findOrCreate(dto, user.sub);
    return ApiResponse.created(batch, 'Invigilation allocation batch ready.');
  }

  @Get()
  async findAll(@Query() query: ListAllocationBatchesQueryDto) {
    const batches = await this.batchesService.findAll(query);
    return ApiResponse.ok(
      batches,
      'Invigilation allocation batches fetched successfully.',
    );
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const batch = await this.batchesService.findOne(id);
    return ApiResponse.ok(
      batch,
      'Invigilation allocation batch fetched successfully.',
    );
  }

  @Patch(':id/submit')
  async submit(@Param('id', ParseIntPipe) id: number) {
    const batch = await this.batchesService.submit(id);
    return ApiResponse.ok(batch, 'Invigilation allocation submitted.');
  }

  @Patch(':id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard, SeniorCoeGuard)
  async publish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    const batch = await this.batchesService.publish(id, user.sub);
    return ApiResponse.ok(batch, 'Invigilation allocation published.');
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.batchesService.remove(id);
    return ApiResponse.ok(
      result,
      'Invigilation allocation batch deleted successfully.',
    );
  }
}
