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
import { ListAnnouncementsQueryDto } from './dto/list-announcements-query.dto';
import { AuditLogService } from 'src/modules/fees-billing/audit-log/audit-log.service';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

@Controller('announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnnouncementsController {
  constructor(
    private readonly announcementsService: AnnouncementsService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * GET /api/v1/announcements/lookup/roles
   * Admin/Principal/Billing — every backend role, for the "Target roles"
   * checkbox grid (target_audience: 'roles'). Billing needs this for its
   * real "All HoDs" audience option (picks out the real 'hod' role id).
   *
   * Error responses:
   *  401 UNAUTHORIZED, 403 FORBIDDEN, 500 INTERNAL_ERROR
   */
  @Get('lookup/roles')
  @Roles(ROLES.ADMIN, ROLES.PRINCIPAL, ROLES.BILLING, ROLES.IQAC)
  lookupRoles() {
    return this.announcementsService.lookupRoles();
  }

  /**
   * GET /api/v1/announcements/lookup/departments
   * Admin/Principal only — departments that have at least one class in the given batch.
   *
   * Error responses:
   *  401 UNAUTHORIZED, 403 FORBIDDEN, 500 INTERNAL_ERROR
   */
  @Get('lookup/departments')
  @Roles(ROLES.ADMIN, ROLES.PRINCIPAL, ROLES.SECRETARY, ROLES.BILLING)
  lookupDepartments(@Query('batch_id', ParseIntPipe) batchId: number) {
    return this.announcementsService.lookupDepartmentsForBatch(batchId);
  }

  /**
   * GET /api/v1/announcements/lookup/classes
   * Admin/Principal: batch_id + department_id required, used as supplied.
   * HOD: batch_id required; department_id must NOT be supplied — it is always
   * resolved from the HOD's own department.
   *
   * Error responses:
   *  400 VALIDATION_ERROR / DEPARTMENT_ID_REQUIRED
   *  401 UNAUTHORIZED, 403 FORBIDDEN, 404 HOD_FACULTY_RECORD_NOT_FOUND, 500 INTERNAL_ERROR
   */
  @Get('lookup/classes')
  @Roles(ROLES.ADMIN, ROLES.PRINCIPAL, ROLES.HOD, ROLES.SECRETARY, ROLES.BILLING)
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
   * Faculty or HoD - an HoD who is themselves mapped to teach/mentor a
   * class gets the same real list; one who isn't just gets an empty array.
   *
   * Error responses:
   *  401 UNAUTHORIZED, 403 FORBIDDEN, 404 FACULTY_RECORD_NOT_FOUND, 500 INTERNAL_ERROR
   */
  @Get('lookup/assigned-classes')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  lookupAssignedClasses(@CurrentUser() user: JwtPayload) {
    return this.announcementsService.lookupAssignedClasses(user);
  }

  /**
   * GET /api/v1/announcements/lookup/all-classes
   * Higher Education Cell / Billing — every class in one flat list, since
   * both cells' announcements are always institution-wide (students across
   * every department) with no department/batch scope to narrow by.
   */
  @Get('lookup/all-classes')
  @Roles(ROLES.HIGHER_EDUCATION, ROLES.BILLING, ROLES.IQAC)
  lookupAllClasses() {
    return this.announcementsService.lookupAllClasses();
  }

  /**
   * GET /api/v1/announcements/lookup/my-department
   * HOD only — their own department, for the "Target faculty" toggle
   * (an HOD may only ever broadcast to their own department's faculty).
   *
   * Error responses:
   *  401 UNAUTHORIZED, 403 FORBIDDEN, 404 DEPARTMENT_NOT_FOUND, 500 INTERNAL_ERROR
   */
  @Get('lookup/my-department')
  @Roles(ROLES.HOD)
  lookupMyDepartment(@CurrentUser() user: JwtPayload) {
    return this.announcementsService.lookupMyDepartment(user);
  }

  /**
   * POST /api/v1/announcements/attachments
   * Admin/HOD/Faculty/Principal/Placement/Higher Education — uploads a
   * single file to Supabase Storage (private bucket, see StorageService)
   * and returns its storage key + a short-lived signed URL. The key is what
   * gets attached to an announcement's file_key column on create/update —
   * this endpoint itself never touches the announcements table.
   *
   * Error responses:
   *  400 VALIDATION_ERROR – no file, or file too large (>10MB)
   *  401 UNAUTHORIZED, 403 FORBIDDEN, 500 INTERNAL_ERROR / STORAGE_UPLOAD_FAILED
   */
  @Post('attachments')
  @Roles(
    ROLES.ADMIN,
    ROLES.PRINCIPAL,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.PLACEMENT,
    ROLES.HIGHER_EDUCATION,
    ROLES.EDC_COORDINATOR,
    ROLES.SECRETARY,
    ROLES.BILLING,
    ROLES.IQAC,
  )
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }),
  )
  uploadAttachments(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({
        message: 'No file was uploaded (expected multipart field "file")',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return this.announcementsService.uploadAttachment(file);
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
    ROLES.PRINCIPAL,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.PLACEMENT,
    ROLES.HIGHER_EDUCATION,
    ROLES.EDC_COORDINATOR,
    ROLES.SECRETARY,
    ROLES.BILLING,
    ROLES.IQAC,
  )
  async create(@Body() dto: CreateAnnouncementDto, @CurrentUser() user: JwtPayload) {
    const result = await this.announcementsService.create(dto, user);
    void this.auditLog.record({
      entity_type: 'announcement',
      entity_id: (result as { id: number }).id,
      action: 'created',
      performed_by_user_id: user.sub,
      new_value: { title: dto.title, target_audience: dto.target_audience },
    });
    return result;
  }

  /**
   * POST /api/v1/announcements/:id/attachment
   * Only the announcement's own author may attach a file to it (same
   * ownership rule as PUT/PATCH/DELETE) — a separate call after create(),
   * for attaching a file to an announcement that already exists (as opposed
   * to POST /announcements/attachments' upload-then-create-with-file_key
   * flow for a brand new post).
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
    ROLES.PRINCIPAL,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.PLACEMENT,
    ROLES.HIGHER_EDUCATION,
  )
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }),
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
    return this.announcementsService.attachFileToAnnouncement(id, file, user);
  }

  /**
   * GET /api/v1/announcements?status=
   * `status` is an optional filter (e.g. status=draft for the "Drafts"
   * tab) — regardless of role, a draft is only ever visible to its own
   * author (see buildVisibilityQuery), so this can never leak someone
   * else's drafts.
   *
   * Error responses:
   *  401 UNAUTHORIZED
   *  404 HOD_FACULTY_RECORD_NOT_FOUND / FACULTY_RECORD_NOT_FOUND / STUDENT_RECORD_NOT_FOUND
   *  500 INTERNAL_ERROR
   */
  @Get()
  findAll(
    @Query() query: ListAnnouncementsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.announcementsService.findAll(user, query.status);
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
    ROLES.PRINCIPAL,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.PLACEMENT,
    ROLES.HIGHER_EDUCATION,
    ROLES.EDC_COORDINATOR,
    ROLES.SECRETARY,
    ROLES.BILLING,
    ROLES.IQAC,
  )
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAnnouncementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.announcementsService.update(id, dto, user);
    void this.auditLog.record({
      entity_type: 'announcement',
      entity_id: id,
      action: 'updated',
      performed_by_user_id: user.sub,
      new_value: dto as Record<string, unknown>,
    });
    return result;
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
    ROLES.PRINCIPAL,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.PLACEMENT,
    ROLES.HIGHER_EDUCATION,
    ROLES.EDC_COORDINATOR,
    ROLES.SECRETARY,
    ROLES.BILLING,
    ROLES.IQAC,
  )
  async patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAnnouncementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.announcementsService.update(id, dto, user);
    void this.auditLog.record({
      entity_type: 'announcement',
      entity_id: id,
      action: 'updated',
      performed_by_user_id: user.sub,
      new_value: dto as Record<string, unknown>,
    });
    return result;
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
    ROLES.PRINCIPAL,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.PLACEMENT,
    ROLES.HIGHER_EDUCATION,
    ROLES.EDC_COORDINATOR,
    ROLES.SECRETARY,
    ROLES.BILLING,
    ROLES.IQAC,
  )
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.announcementsService.remove(id, user);
    void this.auditLog.record({
      entity_type: 'announcement',
      entity_id: id,
      action: 'deleted',
      performed_by_user_id: user.sub,
      old_value: { title: (result as { title?: string }).title },
    });
    return result;
  }
}
