import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { OdService } from './od.service';
import { CreateOdRequestDto } from './dto/create-od-request.dto';
import { SearchOdRequestsDto } from './dto/search-od-requests.dto';

@Controller('sports-admin/od-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN)
export class OdController {
  constructor(private readonly odService: OdService) {}

  @Get()
  findAll(@Query() query: SearchOdRequestsDto) {
    return this.odService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateOdRequestDto, @CurrentUser() user: JwtPayload) {
    return this.odService.create(dto, user.sub);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.odService.findOne(id);
  }

  @Post(':id/approve')
  approve(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.odService.approve(id, user.sub);
  }

  @Post(':id/reject')
  reject(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.odService.reject(id, user.sub);
  }
}
