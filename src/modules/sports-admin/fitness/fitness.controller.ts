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
import { FitnessService } from './fitness.service';
import { CreateFitnessTestDto } from './dto/create-fitness-test.dto';
import { UpdateFitnessTestDto } from './dto/update-fitness-test.dto';
import { SearchFitnessTestsDto } from './dto/search-fitness-tests.dto';

@Controller('sports-admin/fitness-tests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class FitnessController {
  constructor(private readonly fitnessService: FitnessService) {}

  @Post()
  create(@Body() dto: CreateFitnessTestDto) {
    return this.fitnessService.create(dto);
  }

  @Get()
  findAll(@Query() query: SearchFitnessTestsDto) {
    return this.fitnessService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.fitnessService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFitnessTestDto,
  ) {
    return this.fitnessService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.fitnessService.remove(id);
  }
}
