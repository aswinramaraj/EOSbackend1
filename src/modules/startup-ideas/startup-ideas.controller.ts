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
import { StartupIdeasService } from './startup-ideas.service';
import { CreateStartupIdeaDto } from './dto/create-startup-idea.dto';
import { UpdateStartupIdeaDto } from './dto/update-startup-idea.dto';

/** EDC Coordinator's Startup Ideas screen — real `startup_ideas` table, added
 * for this module. Institution-wide, no department/class scoping. */
@Controller('me/startup-ideas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.EDC_COORDINATOR)
export class StartupIdeasController {
  constructor(private readonly service: StartupIdeasService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateStartupIdeaDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStartupIdeaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(id, dto, user.sub);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
