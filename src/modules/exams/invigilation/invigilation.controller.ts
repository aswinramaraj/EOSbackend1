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
import { InvigilationService } from './invigilation.service';
import { CreateInvigilationDto } from './dto/create-invigilation.dto';
import { UpdateInvigilationDto } from './dto/update-invigilation.dto';
import { FindInvigilationQueryDto } from './dto/find-invigilation-query.dto';
import { VenuesOverviewQueryDto } from './dto/venues-overview-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { ApiResponse } from 'src/common/dto/api-response.dto';

@Controller('invigilation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class InvigilationController {
  constructor(private readonly invigilationService: InvigilationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createInvigilationDto: CreateInvigilationDto) {
    const duty = await this.invigilationService.create(createInvigilationDto);
    return ApiResponse.created(duty, 'Invigilation duty assigned successfully');
  }

  // Must come before the ":id" route below so these literal paths aren't parsed as an id.
  @Get('venues-overview')
  getVenuesOverview(@Query() query: VenuesOverviewQueryDto) {
    return this.invigilationService.getVenuesOverview(query);
  }

  @Get('unfilled-slots')
  async getUnfilledSlots(@Query() query: VenuesOverviewQueryDto) {
    const slots = await this.invigilationService.getUnfilledSlots(query);
    return ApiResponse.ok(slots, 'Unfilled invigilation slots fetched successfully');
  }

  @Get('stats')
  async getStats() {
    const stats = await this.invigilationService.getStats();
    return ApiResponse.ok(stats, 'Invigilation stats fetched successfully');
  }

  @Post('auto-assign')
  async autoAssign(@Body() dto: { exam_id: number; hall_plan_id: number; duty_date: string; session: 'FN' | 'AN' }) {
    const duty = await this.invigilationService.autoAssign(dto);
    return ApiResponse.created(duty, 'Duty auto-assigned successfully');
  }

  @Post(':id/remind')
  async remind(@Param('id', ParseIntPipe) id: number) {
    const notification = await this.invigilationService.remind(id);
    return ApiResponse.created(notification, 'Reminder sent successfully');
  }

  @Get()
  findAll(@Query() query: FindInvigilationQueryDto) {
    return this.invigilationService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.invigilationService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateInvigilationDto: UpdateInvigilationDto,
  ) {
    const duty = await this.invigilationService.update(
      id,
      updateInvigilationDto,
    );
    return ApiResponse.ok(duty, 'Invigilation duty updated successfully');
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.invigilationService.remove(id);
    return ApiResponse.ok(null, 'Invigilation duty removed successfully');
  }

  @Post(':id/acknowledge')
  async acknowledge(@Param('id', ParseIntPipe) id: number) {
    const duty = await this.invigilationService.acknowledge(id);
    return ApiResponse.ok(duty, 'Duty acknowledged successfully');
  }
}
