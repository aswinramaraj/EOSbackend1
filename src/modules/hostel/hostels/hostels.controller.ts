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
import { HostelsService } from './hostels.service';
import { CreateHostelDto } from './dto/create-hostel.dto';
import { UpdateHostelDto } from './dto/update-hostel.dto';
import { SearchHostelsDto } from './dto/search-hostels.dto';

@Controller('hostel/hostels')
export class HostelsController {
  constructor(private readonly hostelsService: HostelsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.WARDEN)
  create(@Body() dto: CreateHostelDto) {
    return this.hostelsService.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Query() query: SearchHostelsDto) {
    return this.hostelsService.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.hostelsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.WARDEN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateHostelDto) {
    return this.hostelsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.WARDEN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.hostelsService.remove(id);
  }
}
