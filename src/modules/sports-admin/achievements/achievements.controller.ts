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
import { AchievementsService } from './achievements.service';
import { CreateAchievementDto } from './dto/create-achievement.dto';
import { UpdateAchievementDto } from './dto/update-achievement.dto';
import { SearchAchievementsDto } from './dto/search-achievements.dto';

@Controller('sports-admin/achievements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class AchievementsController {
  constructor(private readonly achievementsService: AchievementsService) {}

  @Post()
  create(@Body() dto: CreateAchievementDto) {
    return this.achievementsService.create(dto);
  }

  @Get()
  findAll(@Query() query: SearchAchievementsDto) {
    return this.achievementsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.achievementsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAchievementDto,
  ) {
    return this.achievementsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.achievementsService.remove(id);
  }
}
