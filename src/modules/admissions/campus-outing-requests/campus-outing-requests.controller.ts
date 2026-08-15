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
import { CampusOutingRequestsService } from './campus-outing-requests.service';
import { ListCampusOutingRequestsQueryDto } from './dto/list-campus-outing-requests-query.dto';
import { FacultyApproveOutingRequestDto } from './dto/faculty-approve-outing-request.dto';
import { HodApproveOutingRequestDto } from './dto/hod-approve-outing-request.dto';

@Controller('me')
export class CampusOutingRequestsController {
  constructor(
    private readonly campusOutingRequestsService: CampusOutingRequestsService,
  ) {}

  /**
   * GET /api/v1/me/campus-outing-requests — Faculty (mentor's review queue)
   * or HoD (own-department queue, faculty_approved/hod_approved/rejected
   * only). Mirrors StudentLeavesController.findAll.
   */
  @Get('campus-outing-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.FACULTY, ROLES.HOD)
  findAll(
    @Query() query: ListCampusOutingRequestsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.campusOutingRequestsService.findAll(query, user);
  }

  /**
   * PATCH /api/v1/me/campus-outing-requests/:id/faculty-approve — Faculty
   * only (the student's assigned mentor). First stage of the two-stage
   * approval chain.
   */
  @Patch('campus-outing-requests/:id/faculty-approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.FACULTY)
  facultyApprove(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FacultyApproveOutingRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.campusOutingRequestsService.facultyApprove(id, dto, user.sub);
  }

  /**
   * PATCH /api/v1/me/campus-outing-requests/:id/hod-approve — HoD only.
   * Second (final) stage of the two-stage approval chain.
   */
  @Patch('campus-outing-requests/:id/hod-approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.HOD)
  hodApprove(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HodApproveOutingRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.campusOutingRequestsService.hodApprove(id, dto, user.sub);
  }
}
