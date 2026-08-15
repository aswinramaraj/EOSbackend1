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
import { ROLES } from 'src/common/constants/roles.constant';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { SearchTeamsDto } from './dto/search-teams.dto';
import { AddRosterEntryDto } from './dto/add-roster-entry.dto';
import { UpdateRosterEntryDto } from './dto/update-roster-entry.dto';

@Controller('sports-admin/teams')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  findAll(@Query() query: SearchTeamsDto) {
    return this.teamsService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateTeamDto) {
    return this.teamsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.teamsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTeamDto) {
    return this.teamsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.teamsService.remove(id);
  }

  @Post(':id/roster')
  addRosterEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddRosterEntryDto,
  ) {
    return this.teamsService.addRosterEntry(id, dto);
  }

  @Patch(':id/roster/:studentId')
  updateRosterEntry(
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: UpdateRosterEntryDto,
  ) {
    return this.teamsService.updateRosterEntry(id, studentId, dto);
  }

  @Delete(':id/roster/:studentId')
  removeRosterEntry(
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.teamsService.removeRosterEntry(id, studentId);
  }

  @Post(':id/confirm')
  confirm(@Param('id', ParseIntPipe) id: number) {
    return this.teamsService.confirm(id);
  }
}
