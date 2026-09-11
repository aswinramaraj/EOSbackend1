import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';

class RegisterDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  count?: number;
}

/** Event & Workshop Coordination — Secretary Portal screen. */
@Controller('me/department-events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SECRETARY, ROLES.ADMIN, ROLES.PRINCIPAL)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateEventDto, @CurrentUser() user: JwtPayload) {
    return this.eventsService.create(user, dto, user.sub);
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query('department_id') departmentId?: string) {
    return this.eventsService.findAll(user, departmentId ? +departmentId : undefined);
  }

  @Patch(':id/register')
  register(@Param('id', ParseIntPipe) id: number, @Body() dto: RegisterDto, @CurrentUser() user: JwtPayload) {
    return this.eventsService.register(user, id, dto.count ?? 25);
  }

  @Patch(':id/advance')
  advance(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.eventsService.advance(user, id);
  }
}
