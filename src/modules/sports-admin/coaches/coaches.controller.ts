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
import { CoachesService } from './coaches.service';
import { CreateCoachProfileDto } from './dto/create-coach-profile.dto';
import { UpdateCoachProfileDto } from './dto/update-coach-profile.dto';
import { SearchCoachesDto } from './dto/search-coaches.dto';

@Controller('sports-admin/coaches')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class CoachesController {
  constructor(private readonly coachesService: CoachesService) {}

  @Get()
  findAll(@Query() query: SearchCoachesDto) {
    return this.coachesService.findAll(query);
  }

  // Must be declared before the ':id' route below, otherwise Nest would try
  // to parse 'discipline-summary' as a numeric :id.
  @Get('discipline-summary')
  disciplineSummary() {
    return this.coachesService.disciplineSummary();
  }

  @Post()
  create(@Body() dto: CreateCoachProfileDto) {
    return this.coachesService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.coachesService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCoachProfileDto,
  ) {
    return this.coachesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.coachesService.remove(id);
  }
}
