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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
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
import { UploadFacultyOdAttachmentDto } from './dto/upload-faculty-od-attachment.dto';
import { VerifyFacultyOdDto } from './dto/verify-faculty-od.dto';
import { UpdateOwnOdDto } from './dto/update-own-od.dto';

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
  @Roles(
    ROLES.FACULTY,
    ROLES.HOD,
    ROLES.SECRETARY,
    // Non-teaching staff raise their own requests through the same route;
    // the service branches on whether a faculty row exists, not on role.
    ROLES.HR_PAYROLL,
    ROLES.WARDEN,
    // Principal has no faculty row either - same staff_user_id-keyed path
    // as HR Payroll/Secretary/Warden above (see FacultyOdService.create).
    ROLES.PRINCIPAL,
  )
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateFacultyOdDto, @CurrentUser() user: JwtPayload) {
    return this.facultyOdService.create(dto, user);
  }

  /** GET /api/v1/me/faculty-od — Faculty (own only)/HoD/HR Payroll/IQAC/Principal (own only)/Correspondent (review queue). Paginated, filterable. */
  @Get('faculty-od')
  @Roles(
    ROLES.FACULTY,
    ROLES.HOD,
    ROLES.HR_PAYROLL,
    ROLES.IQAC,
    ROLES.SECRETARY,
    ROLES.PRINCIPAL,
    ROLES.CORRESPONDENT,
  )
  findAll(
    @Query() query: ListFacultyOdQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyOdService.findAll(query, user);
  }

  /**
   * PATCH /api/v1/me/faculty-od/:id — HoD (hod_approval_status), HR
   * Payroll (hr_approval_status, after HoD), or Correspondent
   * (correspondent_approval_status — Principal's OD Approval, an
   * independent stage, never gated on hod/hr). Principal is deliberately
   * NOT included here — only ever a CREATE role on this table, same as
   * faculty-leaves.
   */
  @Patch('faculty-od/:id')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL, ROLES.CORRESPONDENT)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFacultyOdDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyOdService.update(id, dto, user);
  }

  /**
   * POST /api/v1/me/faculty-od/:id/attachments — Faculty only, own record.
   * multipart/form-data: optional single "photo" file, optional single
   * "certificate" file, plus optional latitude/longitude text fields.
   */
  @Post('faculty-od/:id/attachments')
  @Roles(ROLES.FACULTY)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'photo', maxCount: 1 },
      { name: 'certificate', maxCount: 1 },
    ]),
  )
  addAttachments(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UploadFacultyOdAttachmentDto,
    @UploadedFiles()
    files: {
      photo?: Array<Express.Multer.File>;
      certificate?: Array<Express.Multer.File>;
    },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyOdService.addAttachments(id, user.sub, dto, files ?? {});
  }

  /** PATCH /api/v1/me/faculty-od/:id/verify — IQAC only. */
  @Patch('faculty-od/:id/verify')
  @Roles(ROLES.IQAC)
  verify(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VerifyFacultyOdDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyOdService.verify(id, dto, user.sub);
  }

  /**
   * PATCH /api/v1/me/my-od/:id — Secretary self-edit of their OWN
   * still-pending (at HR Payroll) OD request.
   */
  @Patch('my-od/:id')
  @Roles(ROLES.SECRETARY)
  updateOwn(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOwnOdDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyOdService.updateOwnStaffRequest(id, user.sub, dto);
  }

  /** DELETE /api/v1/me/faculty-od/:id — Faculty, HoD or Secretary, own request, only while still pending. */
  @Delete('faculty-od/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.SECRETARY)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyOdService.remove(id, user.sub, user.role);
  }
}
