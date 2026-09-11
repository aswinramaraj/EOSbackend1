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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { IncubationsService } from './incubations.service';
import { CreateIncubationDto } from './dto/create-incubation.dto';
import { UpdateIncubationDto } from './dto/update-incubation.dto';
import { CreateMilestoneDto, UpdateMilestoneDto } from './dto/milestone.dto';

/** EDC Coordinator's Incubation screen — real `incubations` +
 * `incubation_milestones` tables, added this session. Read-only routes are
 * additionally opened to Placement (institution-wide) and Faculty/Advisor
 * (own mentees only, see findAllForMentor()) for the Placement/Advisor
 * "who's currently interning at EDC" view — write routes stay EDC-only via
 * the class-level @Roles() below, since method-level @Roles() overrides
 * (not merges with) the class-level one. */
@Controller('me/incubations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.EDC_COORDINATOR)
export class IncubationsController {
  constructor(private readonly service: IncubationsService) {}

  @Get()
  @Roles(ROLES.EDC_COORDINATOR, ROLES.PLACEMENT)
  findAll() {
    return this.service.findAll();
  }

  @Get('mine')
  @Roles(ROLES.FACULTY)
  findMine(@CurrentUser() user: JwtPayload) {
    return this.service.findAllForMentor(user.sub);
  }

  @Get(':id')
  @Roles(ROLES.EDC_COORDINATOR, ROLES.PLACEMENT, ROLES.FACULTY)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateIncubationDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIncubationDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @Post(':id/milestones')
  @HttpCode(HttpStatus.CREATED)
  addMilestone(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateMilestoneDto,
  ) {
    return this.service.addMilestone(id, dto);
  }

  @Patch('milestones/:milestoneId')
  updateMilestone(
    @Param('milestoneId', ParseIntPipe) milestoneId: number,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.service.updateMilestone(milestoneId, dto);
  }
}
