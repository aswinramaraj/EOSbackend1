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
import { HallPlansService } from './hall-plans.service';
import { CreateHallPlanDto } from './dto/create-hall-plan.dto';
import { UpdateHallPlanDto } from './dto/update-hall-plan.dto';
import { FindHallPlansQueryDto } from './dto/find-hall-plans-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { ApiResponse } from 'src/common/dto/api-response.dto';

@Controller('hall-plans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HallPlansController {
  constructor(private readonly hallPlansService: HallPlansService) {}

  @Post()
  @Roles(ROLES.COE)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createHallPlanDto: CreateHallPlanDto) {
    const hallPlan = await this.hallPlansService.create(createHallPlanDto);
    return ApiResponse.created(hallPlan, 'Hall plan created successfully');
  }

  @Get()
  @Roles(ROLES.COE)
  findAll(@Query() query: FindHallPlansQueryDto) {
    return this.hallPlansService.findAll(query);
  }

  @Get(':id')
  @Roles(ROLES.COE)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.hallPlansService.findOne(id);
  }

  @Patch(':id')
  @Roles(ROLES.COE)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateHallPlanDto: UpdateHallPlanDto,
  ) {
    const hallPlan = await this.hallPlansService.update(id, updateHallPlanDto);
    return ApiResponse.ok(hallPlan, 'Hall plan updated successfully');
  }

  @Delete(':id')
  @Roles(ROLES.COE)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.hallPlansService.remove(id);
    return ApiResponse.ok(null, 'Hall plan deleted successfully');
  }
}
