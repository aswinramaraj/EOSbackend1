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
import { FacultyLeavesService } from './faculty-leaves.service';
import { CreateFacultyLeafDto } from './dto/create-faculty-leaf.dto';
import { UpdateFacultyLeafDto } from './dto/update-faculty-leaf.dto';
import { ListFacultyLeafQueryDto } from './dto/list-faculty-leaf-query.dto';
import { UpdateOwnLeaveDto } from './dto/update-own-leave.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacultyLeavesController {
  constructor(private readonly facultyLeavesService: FacultyLeavesService) {}

  /**
   * POST /api/v1/faculty-leaves — Faculty or HoD, for the caller's own
   * record. An HoD's own request skips the HoD-review stage entirely (see
   * FacultyLeavesService.create) since they can't review their own leave.
   */
  @Post('create-leaves')
  @Roles(
    ROLES.FACULTY,
    ROLES.HOD,
    ROLES.SECRETARY,
    // Non-teaching staff raise their own requests through the same route;
    // the service branches on whether a faculty row exists, not on role.
    ROLES.HR_PAYROLL,
    ROLES.WARDEN,
  )
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateFacultyLeafDto, @CurrentUser() user: JwtPayload) {
    return this.facultyLeavesService.create(dto, user);
  }

  /** GET /api/v1/faculty-leaves — Faculty (own only)/HoD/HR Payroll. Paginated, filterable. */
  @Get('faculty-leaves')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.HR_PAYROLL, ROLES.SECRETARY)
  findAll(
    @Query() query: ListFacultyLeafQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyLeavesService.findAll(query, user);
  }

  /** GET /api/v1/faculty-leaves/:id — Faculty (own only)/HoD/HR Payroll. */
  @Get('faculty-leaves/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.HR_PAYROLL, ROLES.SECRETARY)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyLeavesService.findOne(id, user);
  }

  /** PATCH /api/v1/faculty-leaves/:id — HoD (hod_approval_status) or HR Payroll (hr_approval_status, after HoD). */
  @Patch('faculty-leaves/:id')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFacultyLeafDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyLeavesService.update(id, dto, user);
  }

  /**
   * PATCH /api/v1/me/my-leaves/:id — Secretary self-edit of their OWN
   * still-pending (at HR Payroll) leave request. Distinct route/DTO from
   * the reviewer update() above (which only ever sets approval fields).
   */
  @Patch('my-leaves/:id')
  @Roles(ROLES.SECRETARY)
  updateOwn(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOwnLeaveDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyLeavesService.updateOwnStaffRequest(id, user.sub, dto);
  }

  /** DELETE /api/v1/faculty-leaves/:id — Faculty or HoD, own request, only while fully pending. */
  @Delete('faculty-leaves/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.SECRETARY)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyLeavesService.remove(id, user.sub, user.role);
  }
}
