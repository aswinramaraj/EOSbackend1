import {
  Body,
  Controller,
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
import { FacultyOdService } from './faculty-od.service';
import { CreateFacultyOdDto } from './dto/create-faculty-od.dto';
import { ListFacultyOdQueryDto } from './dto/list-faculty-od-query.dto';
import { UpdateFacultyOdDto } from './dto/update-faculty-od.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacultyOdController {
  constructor(private readonly facultyOdService: FacultyOdService) {}

  /**
   * POST /api/v1/me/create-od — Faculty or HoD, for the caller's own
   * record. An HoD's own request skips the HoD-review stage entirely (see
   * FacultyOdService.create) since they can't review their own OD.
   */
  @Post('create-od')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateFacultyOdDto, @CurrentUser() user: JwtPayload) {
    return this.facultyOdService.create(dto, user);
  }

  /** GET /api/v1/me/faculty-od — Faculty (own only)/HoD/HR Payroll. Paginated, filterable. */
  @Get('faculty-od')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.HR_PAYROLL)
  findAll(
    @Query() query: ListFacultyOdQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyOdService.findAll(query, user);
  }

  /** PATCH /api/v1/me/faculty-od/:id — HoD (hod_approval_status) or HR Payroll (hr_approval_status, after HoD) only. */
  @Patch('faculty-od/:id')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFacultyOdDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyOdService.update(id, dto, user);
  }
}
