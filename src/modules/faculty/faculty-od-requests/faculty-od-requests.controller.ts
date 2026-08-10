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
import { FacultyOdRequestsService } from './faculty-od-requests.service';
import { CreateFacultyOdRequestDto } from './dto/create-faculty-od-request.dto';
import { UpdateFacultyOdRequestDto } from './dto/update-faculty-od-request.dto';
import { ListFacultyOdRequestQueryDto } from './dto/list-faculty-od-request-query.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacultyOdRequestsController {
  constructor(private readonly odRequestsService: FacultyOdRequestsService) {}

  /** POST /api/v1/me/create-od-request — Faculty only, for the caller's own record. */
  @Post('create-od-request')
  @Roles(ROLES.FACULTY)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateFacultyOdRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.odRequestsService.create(dto, user.sub);
  }

  /** GET /api/v1/me/faculty-od-requests — Faculty (own)/HoD (own dept)/HR Payroll (all). Paginated, filterable. */
  @Get('faculty-od-requests')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.HR_PAYROLL)
  findAll(
    @Query() query: ListFacultyOdRequestQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.odRequestsService.findAll(query, user);
  }

  /** GET /api/v1/me/faculty-od-requests/:id — Faculty (own)/HoD (own dept)/HR Payroll. */
  @Get('faculty-od-requests/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.HR_PAYROLL)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.odRequestsService.findOne(id, user);
  }

  /** PATCH /api/v1/me/faculty-od-requests/:id — HoD (own dept) or HR Payroll only. */
  @Patch('faculty-od-requests/:id')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFacultyOdRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.odRequestsService.update(id, dto, user);
  }

  /** DELETE /api/v1/me/faculty-od-requests/:id — Faculty only, own request, only while fully pending. */
  @Delete('faculty-od-requests/:id')
  @Roles(ROLES.FACULTY)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.odRequestsService.remove(id, user.sub);
  }
}