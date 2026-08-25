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
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';
import { RegulationsService } from './regulations.service';
import { ListRegulationsQueryDto } from './dto/list-regulations-query.dto';
import { CreateRegulationDto } from './dto/create-regulation.dto';
import { UpdateRegulationDto } from './dto/update-regulation.dto';
import { CloneRegulationDto } from './dto/clone-regulation.dto';

@Controller('regulations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class RegulationsController {
  constructor(private readonly regulationsService: RegulationsService) {}

  @Get('stats')
  async getStats() {
    const stats = await this.regulationsService.getStats();
    return ApiResponse.ok(stats, 'Regulation stats fetched successfully.');
  }

  @Get()
  async findAll(@Query() query: ListRegulationsQueryDto) {
    const regulations = await this.regulationsService.findAll(query);
    return ApiResponse.ok(regulations, 'Regulations fetched successfully.');
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const regulation = await this.regulationsService.findOne(id);
    return ApiResponse.ok(regulation, 'Regulation fetched successfully.');
  }

  @Post()
  async create(@Body() dto: CreateRegulationDto, @CurrentUser() user: JwtPayload) {
    const regulation = await this.regulationsService.create(dto, user.sub);
    return ApiResponse.created(regulation, 'Regulation created successfully.');
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRegulationDto) {
    const regulation = await this.regulationsService.update(id, dto);
    return ApiResponse.ok(regulation, 'Regulation updated successfully.');
  }

  @Post(':id/clone')
  async clone(@Param('id', ParseIntPipe) id: number, @Body() dto: CloneRegulationDto, @CurrentUser() user: JwtPayload) {
    const regulation = await this.regulationsService.clone(id, dto, user.sub);
    return ApiResponse.created(regulation, 'Regulation cloned successfully.');
  }

  @Post(':id/submit')
  async submit(@Param('id', ParseIntPipe) id: number) {
    const regulation = await this.regulationsService.submit(id);
    return ApiResponse.ok(regulation, 'Regulation submitted and is now active.');
  }

  @Post(':id/courses/:courseId')
  async mapCourse(@Param('id', ParseIntPipe) id: number, @Param('courseId', ParseIntPipe) courseId: number) {
    const mapping = await this.regulationsService.mapCourse(id, courseId);
    return ApiResponse.created(mapping, 'Course mapped to regulation successfully.');
  }

  @Delete(':id/courses/:courseId')
  async unmapCourse(@Param('id', ParseIntPipe) id: number, @Param('courseId', ParseIntPipe) courseId: number) {
    await this.regulationsService.unmapCourse(id, courseId);
    return ApiResponse.ok(null, 'Course unmapped from regulation successfully.');
  }
}
