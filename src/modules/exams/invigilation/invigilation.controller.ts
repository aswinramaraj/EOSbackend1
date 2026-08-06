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

  @Get()
  findAll(@Query() query: FindInvigilationQueryDto) {
    return this.invigilationService.findAll(query);
  }

  @Get('faculty/:facultyId/workload')
  async getFacultyWorkload(
    @Param('facultyId', ParseIntPipe) facultyId: number,
  ) {
    const workload =
      await this.invigilationService.getFacultyWorkload(facultyId);
    return ApiResponse.ok(workload, 'Faculty workload fetched successfully');
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
}
