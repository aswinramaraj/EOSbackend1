import {
  BadRequestException,
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
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@Controller('announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  /**
   * GET /api/v1/announcements/lookup/departments
   * Admin only — departments that have at least one class in the given batch.
   *
   * Error responses:
   *  401 UNAUTHORIZED, 403 FORBIDDEN, 500 INTERNAL_ERROR
   */
  @Get('lookup/departments')
  @Roles(ROLES.ADMIN)
  lookupDepartments(@Query('batch_id', ParseIntPipe) batchId: number) {
    return this.announcementsService.lookupDepartmentsForBatch(batchId);
  }

  /**
   * GET /api/v1/announcements/lookup/classes
   * Admin: batch_id + department_id required, used as supplied.
   * HOD: batch_id required; department_id must NOT be supplied — it is always
   * resolved from the HOD's own department.
   *
   * Error responses:
   *  400 VALIDATION_ERROR / DEPARTMENT_ID_REQUIRED
   *  401 UNAUTHORIZED, 403 FORBIDDEN, 404 HOD_FACULTY_RECORD_NOT_FOUND, 500 INTERNAL_ERROR
   */
  @Get('lookup/classes')
  @Roles(ROLES.ADMIN, ROLES.HOD)
  lookupClasses(
    @Query('batch_id', ParseIntPipe) batchId: number,
    @Query('department_id', new ParseIntPipe({ optional: true }))
    departmentId: number | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.announcementsService.lookupClasses(batchId, departmentId, user);
  }

  /**
   * GET /api/v1/announcements/lookup/assigned-classes
   * Faculty only.
   *
   * Error responses:
   *  401 UNAUTHORIZED, 403 FORBIDDEN, 404 FACULTY_RECORD_NOT_FOUND, 500 INTERNAL_ERROR
   */
  @Get('lookup/assigned-classes')
  @Roles(ROLES.FACULTY)
  lookupAssignedClasses(@CurrentUser() user: JwtPayload) {
    return this.announcementsService.lookupAssignedClasses(user);
  }

  /**
   * POST /api/v1/announcements
   *
   * Error responses:
   *  400 VALIDATION_ERROR
   *  401 UNAUTHORIZED
   *  403 FORBIDDEN / CLASS_OUTSIDE_DEPARTMENT / CLASS_NOT_ASSIGNED / ROLE_NOT_PERMITTED
   *  404 CLASS_NOT_FOUND / HOD_FACULTY_RECORD_NOT_FOUND / FACULTY_RECORD_NOT_FOUND
   *  500 INTERNAL_ERROR
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    ROLES.ADMIN,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.PRINCIPAL,
    ROLES.PLACEMENT,
  )
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() user: JwtPayload) {
    return this.announcementsService.create(dto, user);
  }

  /**
   * POST /api/v1/announcements/:id/attachment
   * Only the announcement's own author may attach a file to it (same
   * ownership rule as PUT/PATCH/DELETE) — a separate call after create(),
   * not a field on it, matching ProfileController's resume-upload pattern.
   *
   * Error responses:
   *  400 VALIDATION_ERROR – no file in the "file" field
   *  403 NOT_OWNER
   *  404 ANNOUNCEMENT_NOT_FOUND
   *  500 INTERNAL_ERROR / STORAGE_UPLOAD_FAILED
   */
  @Post(':id/attachment')
  @Roles(
    ROLES.ADMIN,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.PRINCIPAL,
    ROLES.PLACEMENT,
  )
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  uploadAttachment(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) {
      throw new BadRequestException({
        message: 'No file was uploaded (expected multipart field "file")',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return this.announcementsService.uploadAttachment(id, file, user);
  }

  /**
   * GET /api/v1/announcements
   *
   * Error responses:
   *  401 UNAUTHORIZED
   *  404 HOD_FACULTY_RECORD_NOT_FOUND / FACULTY_RECORD_NOT_FOUND / STUDENT_RECORD_NOT_FOUND
   *  500 INTERNAL_ERROR
   */
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.announcementsService.findAll(user);
  }

  /**
   * GET /api/v1/announcements/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED
   *  404 ANNOUNCEMENT_NOT_FOUND – not found, or found but not visible to this caller
   *  500 INTERNAL_ERROR
   */
  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.announcementsService.findOne(id, user);
  }

  /**
   * PUT /api/v1/announcements/:id
   *
   * Error responses:
   *  400 VALIDATION_ERROR
   *  401 UNAUTHORIZED
   *  403 NOT_OWNER / CLASS_OUTSIDE_DEPARTMENT / CLASS_NOT_ASSIGNED / ROLE_NOT_PERMITTED
   *  404 ANNOUNCEMENT_NOT_FOUND / CLASS_NOT_FOUND
   *  500 INTERNAL_ERROR
   */
  @Put(':id')
  @Roles(
    ROLES.ADMIN,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.PRINCIPAL,
    ROLES.PLACEMENT,
  )
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAnnouncementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.announcementsService.update(id, dto, user);
  }

  /**
   * PATCH /api/v1/announcements/:id
   *
   * Same behaviour as PUT — kept as a separate handler because NestJS route
   * metadata cannot be shared by stacking two HTTP-method decorators on one method.
   *
   * Error responses: see PUT /api/v1/announcements/:id
   */
  @Patch(':id')
  @Roles(
    ROLES.ADMIN,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.PRINCIPAL,
    ROLES.PLACEMENT,
  )
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAnnouncementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.announcementsService.update(id, dto, user);
  }

  /**
   * DELETE /api/v1/announcements/:id
   *
   * Error responses:
   *  401 UNAUTHORIZED
   *  403 NOT_OWNER
   *  404 ANNOUNCEMENT_NOT_FOUND
   *  500 INTERNAL_ERROR
   */
  @Delete(':id')
  @Roles(
    ROLES.ADMIN,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.PRINCIPAL,
    ROLES.PLACEMENT,
  )
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.announcementsService.remove(id, user);
  }
}
