import {
  Controller,
  Get,
  Patch,
  Param,
  ParseIntPipe,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { BonafideRequestsService } from './bonafide-requests.service';
import { ListBonafideRequestsDto } from './dto/list-bonafide-requests.dto';
import { DecideBonafideRequestDto } from './dto/decide-bonafide-request.dto';

@Controller('admin/bonafide-requests')
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class BonafideRequestsController {
  constructor(private readonly bonafideRequestsService: BonafideRequestsService) {}

  @Get()
  findAll(@Query() query: ListBonafideRequestsDto) {
    return this.bonafideRequestsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.bonafideRequestsService.findOne(id);
  }

  @Patch(':id/decision')
  decide(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideBonafideRequestDto,
  ) {
    return this.bonafideRequestsService.decide(id, dto);
  }

  @Patch(':id/print')
  print(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.bonafideRequestsService.print(id, user.sub);
  }
}
