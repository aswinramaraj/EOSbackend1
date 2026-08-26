import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { FacultyService } from './faculty.service';
import { CreateFacultyDto } from './dto/create-faculty.dto';
import { UpdateFacultyDto } from './dto/update-faculty.dto';
import { AdminUpdateFacultyDto } from './dto/admin-update-faculty.dto';
import { ListFacultyQueryDto } from './dto/list-faculty-query.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacultyController {
  constructor(private readonly facultyService: FacultyService) {}

  /** POST /api/v1/faculty — Admin/HR Payroll. */
  @Post('faculty')
  @Roles(ROLES.ADMIN, ROLES.HR_PAYROLL)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateFacultyDto, @CurrentUser() user: JwtPayload) {
    return this.facultyService.create(dto, user.sub);
  }

  /**
   * GET /api/v1/faculty — Admin/HoD/HR Payroll/Secretary. Paginated list,
   * filterable by department_id/status. Secretary is now department-scoped
   * (one account per department, mirroring HOD) — forced to her own
   * department server-side inside FacultyService.findAll(), regardless of
   * any client-supplied department_id; every other role's behavior is
   * unchanged.
   */
  @Get('faculty')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.HR_PAYROLL, ROLES.SECRETARY)
  findAll(@Query() query: ListFacultyQueryDto, @CurrentUser() user: JwtPayload) {
    return this.facultyService.findAll(query, user);
  }

  /**
   * GET /api/v1/me/faculty-profile — authenticated faculty's own profile.
   * Moved off 'me/profile' (2026-08-21): that path collided with
   * MeController's student-only handler in me-profile.controller.ts, which
   * registers first and always won, silently shadowing this handler for
   * every Faculty caller (confirmed dead in production — real Faculty JWTs
   * got a 403 "Required role(s): student" from the wrong controller, and no
   * frontend caller referenced this route). Renamed to a distinct path
   * rather than deleted, since the underlying feature is real and unused
   * only because of the collision, not because it's obsolete.
   */
  @Get('faculty-profile')
  @Roles(ROLES.FACULTY)
  getOwnProfile(@CurrentUser() user: JwtPayload) {
    return this.facultyService.getOwnProfile(user.sub);
  }

  /** PATCH /api/v1/faculty/profile — faculty self-service update of editable fields only. */

  /**
   * GET /api/v1/faculty/:id — Admin/HoD/HR Payroll. Sensitive HR
   * information (Aadhaar/PAN/bank details) is included only for
   * Admin/HR Payroll callers — see findOneForAdmin()'s own doc comment.
   */
  @Get('faculty/:id')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.HR_PAYROLL)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyService.findOneForAdmin(id, user.role);
  }

  /** PATCH /api/v1/faculty/:id — Admin/HR Payroll. Distinct from the faculty's own /profile update. */
  @Patch('faculty/:id')
  @Roles(ROLES.ADMIN, ROLES.HR_PAYROLL)
  updateByAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminUpdateFacultyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyService.updateByAdmin(id, dto, user.sub);
  }

  /** DELETE /api/v1/faculty/:id — Admin only. Soft delete (status → inactive on faculty + users). */
  @Delete('faculty/:id')
  @Roles(ROLES.ADMIN)
  removeByAdmin(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyService.removeByAdmin(id, user.sub);
  }

  /** GET /api/v1/faculty/:id/activity — Admin/HoD/HR Payroll. Most recent audit-trail entries for this faculty. */
  @Get('faculty/:id/activity')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.HR_PAYROLL)
  listActivity(@Param('id', ParseIntPipe) id: number) {
    return this.facultyService.listActivity(id);
  }
}
