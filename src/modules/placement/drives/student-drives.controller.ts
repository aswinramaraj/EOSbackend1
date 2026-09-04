import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { DrivesService } from './drives.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { ROLES } from '../../../common/constants/roles.constant';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';

/**
 * Student-facing placement history — per worflow.md, students can view the
 * companies they were put up for and their result stage in each drive.
 */
@Controller('drives/student')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.STUDENT)
export class StudentDrivesController {
  constructor(private readonly drivesService: DrivesService) {}

  @Get('upcoming')
  upcoming(@CurrentUser() user: JwtPayload) {
    return this.drivesService.getUpcomingForStudent(user);
  }

  /** Posted drives not yet shortlisted/applied for — filtered by registration window and (once real) department eligibility, see getPostedForStudentId. */
  @Get('posted')
  posted(@CurrentUser() user: JwtPayload) {
    return this.drivesService.getPostedForStudent(user);
  }

  /** Self-service application onto a posted drive — see applyToDrive for eligibility/resume checks. */
  @Post(':id/apply')
  apply(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.drivesService.applyToDrive(user, id);
  }

  @Get('history')
  history(@CurrentUser() user: JwtPayload) {
    return this.drivesService.getHistoryForStudent(user);
  }
}
