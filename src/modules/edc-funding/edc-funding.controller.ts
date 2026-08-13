import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { EdcFundingService } from './edc-funding.service';
import { CreateFundingRecordDto } from './dto/create-funding-record.dto';
import { UpdateFundingRecordDto } from './dto/update-funding-record.dto';

@Controller('me/edc-funding')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.EDC_COORDINATOR)
export class EdcFundingController {
  constructor(private readonly service: EdcFundingService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('stats')
  stats() {
    return this.service.stats();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateFundingRecordDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFundingRecordDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
