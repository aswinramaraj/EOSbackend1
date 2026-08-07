import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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
import { NoDueService } from './no-due.service';
import { ListNoDueStudentsQueryDto } from './dto/list-no-due-students-query.dto';

/** HoD-facing "No-Due Approval" dashboard — own department only. */
@Controller('me/no-due')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class NoDueController {
  constructor(private readonly noDueService: NoDueService) {}

  /** GET /api/v1/me/no-due/batches — batches in the HoD's own department, for the filter dropdown. */
  @Get('batches')
  getBatches(@CurrentUser() user: JwtPayload) {
    return this.noDueService.getBatches(user.sub);
  }

  /** GET /api/v1/me/no-due/students?batch_id=&status=&search=&page=&limit= */
  @Get('students')
  getStudents(
    @Query() query: ListNoDueStudentsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.noDueService.getStudents(query, user.sub);
  }

  /** POST /api/v1/me/no-due/students/:student_id/approve — HoD-initiated override, no prior student request required. */
  @Post('students/:student_id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('student_id', ParseIntPipe) studentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.noDueService.approveOverride(studentId, user.sub);
  }
}
