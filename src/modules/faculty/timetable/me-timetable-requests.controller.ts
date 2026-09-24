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
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { TimetablePeriodRequestsService } from './timetable-period-requests.service';
import { CreateTakeoverRequestDto } from './dto/create-takeover-request.dto';
import { CreateSwapRequestDto } from './dto/create-swap-request.dto';
import { RespondPeriodRequestDto } from './dto/respond-period-request.dto';
import { ListColleaguesQueryDto } from './dto/list-colleagues-query.dto';

/**
 * Per-day timetable coverage/swap requests — Faculty/HoD (an HoD can also
 * teach classes and use their own timetable, same reasoning MeClassesController
 * already applies to /me/classes/today). Peer-to-peer: the requester's own
 * faculty row is always resolved from the JWT, the request target is always
 * a specific colleague the caller names, never a broadcast.
 */
@Controller('me/timetable-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.FACULTY, ROLES.HOD)
export class MeTimetableRequestsController {
  constructor(private readonly requests: TimetablePeriodRequestsService) {}

  @Post('takeover')
  createTakeover(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTakeoverRequestDto,
  ) {
    return this.requests.createTakeover(user.sub, dto);
  }

  @Post('swap')
  createSwap(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSwapRequestDto,
  ) {
    return this.requests.createSwap(user.sub, dto);
  }

  @Get()
  listMine(@CurrentUser() user: JwtPayload) {
    return this.requests.listMine(user.sub);
  }

  @Get('colleagues')
  listColleagues(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListColleaguesQueryDto,
  ) {
    return this.requests.listColleaguesForDate(user.sub, query.date);
  }

  @Patch(':id/respond')
  respond(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RespondPeriodRequestDto,
  ) {
    return this.requests.respond(user.sub, id, dto);
  }

  @Delete(':id')
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.requests.cancel(user.sub, id);
  }
}
