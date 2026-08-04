import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { OutingsService } from './outings.service';
import { SearchOutingsDto } from './dto/search-outings.dto';
import { DecideOutingDto } from './dto/decide-outing.dto';

@Controller('hostel/outings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
export class OutingsController {
  constructor(private readonly outingsService: OutingsService) {}

  @Get()
  findAll(@Query() query: SearchOutingsDto) {
    return this.outingsService.findAll(query);
  }

  @Patch(':id/decision')
  decide(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideOutingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.outingsService.decide(id, dto, user.sub);
  }
}
