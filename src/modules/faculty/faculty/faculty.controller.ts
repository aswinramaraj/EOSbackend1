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
   * filterable by department_id/status. Secretary added for the Secretary
   * Portal's Reports "faculty summary" table — same institution-wide
   * posture as /announcements and /principal-* (no secretary→department
   * table exists, so this reads unscoped like Admin does).
   */
  @Get('faculty')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.HR_PAYROLL, ROLES.SECRETARY)
  findAll(@Query() query: ListFacultyQueryDto) {
    return this.facultyService.findAll(query);
  }

  /**
   * GET /api/v1/faculty/profile — authenticated faculty's own profile.
   * Declared before ':id' so 'profile' is never captured as a numeric id.
   */
  @Get('profile')
  @Roles(ROLES.FACULTY)
  getOwnProfile(@CurrentUser() user: JwtPayload) {
    return this.facultyService.getOwnProfile(user.sub);
  }

  /** PATCH /api/v1/faculty/profile — faculty self-service update of editable fields only. */

  /** GET /api/v1/faculty/:id — Admin/HoD/HR Payroll. Excludes sensitive HR information. */
  @Get('faculty/:id')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.HR_PAYROLL)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.facultyService.findOneForAdmin(id);
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
