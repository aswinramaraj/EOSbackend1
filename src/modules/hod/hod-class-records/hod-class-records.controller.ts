import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodClassRecordsService } from './hod-class-records.service';

/** HoD Class Records — HoD only. getClassDetail additionally verifies the requested class belongs to the caller's own department. */
@Controller('hod/class-records')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodClassRecordsController {
  constructor(
    private readonly hodClassRecordsService: HodClassRecordsService,
  ) {}

  /** GET /api/v1/hod/class-records/classes */
  @Get('classes')
  getClasses(@CurrentUser() user: JwtPayload) {
    return this.hodClassRecordsService.getClasses(user.sub);
  }

  /** GET /api/v1/hod/class-records/:classId */
  @Get(':classId')
  getClassDetail(
    @CurrentUser() user: JwtPayload,
    @Param('classId', ParseIntPipe) classId: number,
  ) {
    return this.hodClassRecordsService.getClassDetail(user.sub, classId);
  }
}
