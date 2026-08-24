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
import { HodNoDueService } from './hod-no-due.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hod/no-due')
export class HodNoDueController {
  constructor(private readonly noDue: HodNoDueService) {}

  @Get('classes')
  @Roles(ROLES.HOD)
  getClasses(@CurrentUser() user: JwtPayload) {
    return this.noDue.getClasses(user);
  }

  @Get()
  @Roles(ROLES.HOD)
  getList(
    @CurrentUser() user: JwtPayload,
    @Query('class_id', ParseIntPipe) classId: number,
    @Query('search') search?: string,
  ) {
    return this.noDue.getList(user, classId, search);
  }

  @Patch(':studentId')
  @Roles(ROLES.HOD)
  patch(
    @CurrentUser() user: JwtPayload,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() body: { issue?: boolean },
  ) {
    return this.noDue.patch(user, studentId, body);
  }
}
