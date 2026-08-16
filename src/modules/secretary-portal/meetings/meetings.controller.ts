import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { MeetingsService } from './meetings.service';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMomDto } from './dto/update-mom.dto';
import { AddActionItemDto } from './dto/add-action-item.dto';

/** Meeting & MoM Management — Secretary Portal screen. */
@Controller('me/department-meetings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SECRETARY, ROLES.ADMIN, ROLES.PRINCIPAL)
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateMeetingDto, @CurrentUser() user: JwtPayload) {
    return this.meetingsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query('department_id') departmentId?: string) {
    return this.meetingsService.findAll(departmentId ? +departmentId : undefined);
  }

  @Patch(':id/mom')
  updateMom(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMomDto) {
    return this.meetingsService.updateMom(id, dto.mom_text);
  }

  @Patch(':id/circulate')
  circulate(@Param('id', ParseIntPipe) id: number) {
    return this.meetingsService.circulate(id);
  }

  @Post(':id/action-items')
  addActionItem(@Param('id', ParseIntPipe) id: number, @Body() dto: AddActionItemDto) {
    return this.meetingsService.addActionItem(id, dto.label);
  }

  @Patch(':id/action-items/:itemId/toggle')
  toggleActionItem(@Param('id', ParseIntPipe) id: number, @Param('itemId', ParseIntPipe) itemId: number) {
    return this.meetingsService.toggleActionItem(id, itemId);
  }
}
