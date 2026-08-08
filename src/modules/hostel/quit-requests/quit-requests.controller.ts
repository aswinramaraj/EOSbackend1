import {
  Body,
  Controller,
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
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { QuitRequestsService } from './quit-requests.service';
import { CreateQuitRequestDto } from './dto/create-quit-request.dto';
import { DecideQuitRequestDto } from './dto/decide-quit-request.dto';
import { SearchQuitRequestsDto } from './dto/search-quit-requests.dto';

@Controller('hostel-quit-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
export class QuitRequestsController {
  constructor(private readonly quitRequestsService: QuitRequestsService) {}

  @Post()
  create(@Body() dto: CreateQuitRequestDto) {
    return this.quitRequestsService.create(dto);
  }

  @Get()
  findAll(@Query() query: SearchQuitRequestsDto) {
    return this.quitRequestsService.findAll(query);
  }

  @Patch(':id/decision')
  decide(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideQuitRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.quitRequestsService.decide(id, dto, user.sub);
  }
}
