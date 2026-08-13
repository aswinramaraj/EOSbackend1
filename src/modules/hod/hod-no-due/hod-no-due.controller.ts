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

@Controller('hod/no-due')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodNoDueController {
  constructor(private readonly hodNoDueService: HodNoDueService) {}

  /** GET /api/v1/hod/no-due/classes */
  @Get('classes')
  getClasses(@CurrentUser() user: JwtPayload) {
    return this.hodNoDueService.getClasses(user.sub);
  }

  /** GET /api/v1/hod/no-due?class_id=&search= */
  @Get()
  getList(
    @CurrentUser() user: JwtPayload,
    @Query('class_id', ParseIntPipe) classId: number,
    @Query('search') search?: string,
  ) {
    return this.hodNoDueService.getList(user.sub, classId, search);
  }

  /** PATCH /api/v1/hod/no-due/:studentId */
  @Patch(':studentId')
  updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body()
    patch: {
      library_cleared?: boolean;
      laboratory_cleared?: boolean;
      fees_cleared?: boolean;
      hostel_cleared?: boolean;
      sports_cleared?: boolean;
      issue?: boolean;
    },
  ) {
    return this.hodNoDueService.updateStatus(user.sub, studentId, patch);
  }
}
