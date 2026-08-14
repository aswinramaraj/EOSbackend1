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
import { TrialsService } from './trials.service';
import { CreateTrialDto } from './dto/create-trial.dto';
import { UpdateTrialDto } from './dto/update-trial.dto';
import { SelectTrialDto } from './dto/select-trial.dto';
import { SearchTrialsDto } from './dto/search-trials.dto';

@Controller('sports-admin/trials')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class TrialsController {
  constructor(private readonly trialsService: TrialsService) {}

  @Get()
  findAll(@Query() query: SearchTrialsDto) {
    return this.trialsService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateTrialDto) {
    return this.trialsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.trialsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTrialDto) {
    return this.trialsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.trialsService.remove(id);
  }

  @Post(':id/select')
  select(@Param('id', ParseIntPipe) id: number, @Body() dto: SelectTrialDto) {
    return this.trialsService.select(id, dto);
  }

  @Post(':id/hold')
  hold(@Param('id', ParseIntPipe) id: number) {
    return this.trialsService.hold(id);
  }
}
