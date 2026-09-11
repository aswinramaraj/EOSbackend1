import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { OutpassService } from './outpass.service';
import { CreateOutpassDto } from './dto/create-outpass.dto';
import { ListOutpassQueryDto } from './dto/list-outpass-query.dto';
import { IsIn } from 'class-validator';

class UpdateOutpassStatusDto {
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';
}

/** Student Outpass — Secretary Portal "Student Outpass" screen. */
@Controller('me/student-outpasses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SECRETARY, ROLES.ADMIN, ROLES.PRINCIPAL)
export class OutpassController {
  constructor(private readonly outpassService: OutpassService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateOutpassDto, @CurrentUser() user: JwtPayload) {
    return this.outpassService.create(dto, user.sub, user);
  }

  @Get()
  findAll(@Query() query: ListOutpassQueryDto, @CurrentUser() user: JwtPayload) {
    return this.outpassService.findAll(query, user);
  }

  @Patch(':id/status')
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOutpassStatusDto, @CurrentUser() user: JwtPayload) {
    return this.outpassService.updateStatus(id, dto.status, user.sub, user);
  }
}
