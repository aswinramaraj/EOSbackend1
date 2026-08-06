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
import { MalpracticeService } from './malpractice.service';
import { CreateMalpracticeIncidentDto } from './dto/create-malpractice-incident.dto';
import { UpdateMalpracticeIncidentDto } from './dto/update-malpractice-incident.dto';
import { FindMalpracticeQueryDto } from './dto/find-malpractice-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';

/** The invigilator who catches an incident files it; everything past that is COE-only. */
@Controller('malpractice-incidents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class MalpracticeController {
  constructor(private readonly malpracticeService: MalpracticeService) {}

  @Post()
  @Roles(ROLES.COE, ROLES.FACULTY)
  async create(
    @Body() dto: CreateMalpracticeIncidentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const incident = await this.malpracticeService.create(dto, user.sub);
    return ApiResponse.created(
      incident,
      'Malpractice incident recorded successfully.',
    );
  }

  @Get()
  async findAll(@Query() query: FindMalpracticeQueryDto) {
    const incidents = await this.malpracticeService.findAll(query);
    return ApiResponse.ok(
      incidents,
      'Malpractice incidents fetched successfully.',
    );
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const incident = await this.malpracticeService.findOne(id);
    return ApiResponse.ok(
      incident,
      'Malpractice incident fetched successfully.',
    );
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMalpracticeIncidentDto,
  ) {
    const incident = await this.malpracticeService.update(id, dto);
    return ApiResponse.ok(
      incident,
      'Malpractice incident updated successfully.',
    );
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.malpracticeService.remove(id);
    return ApiResponse.ok(result, 'Malpractice incident deleted successfully.');
  }
}
