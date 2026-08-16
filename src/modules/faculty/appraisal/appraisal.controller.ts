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
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { AppraisalService } from './appraisal.service';
import { CreateAppraisalDto } from './dto/create-appraisal.dto';
import { UpdateAppraisalDto } from './dto/update-appraisal.dto';
import { ListAppraisalQueryDto } from './dto/list-appraisal-query.dto';
import { ListAppraisalCriteriaQueryDto } from './dto/list-appraisal-criteria-query.dto';
import { UploadAppraisalAttachmentDto } from './dto/upload-appraisal-attachment.dto';

const MAX_ATTACHMENT_FILES = 5;
const MAX_ATTACHMENT_FILE_SIZE_BYTES = 10 * 1024 * 1024;

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppraisalController {
  constructor(private readonly appraisalService: AppraisalService) {}

  /**
   * GET /api/v1/appraisal-criteria?academic_year= — Faculty or HoD.
   * Reference data (divisions + criteria) for the Apply form.
   */
  @Get('appraisal-criteria')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.SECRETARY)
  findCriteria(@Query() query: ListAppraisalCriteriaQueryDto) {
    return this.appraisalService.findCriteria(query);
  }

  /**
   * POST /api/v1/appraisal — Faculty or HoD, for the caller's own record.
   * An HoD's own appraisal skips the HoD-review stage entirely (see
   * AppraisalService.create) and goes straight to HR scoring, same
   * treatment as Leave/OD.
   */
  @Post('appraisal_requests')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.SECRETARY)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateAppraisalDto, @CurrentUser() user: JwtPayload) {
    return this.appraisalService.create(dto, user);
  }

  /** GET /api/v1/appraisal — Faculty (own only)/HoD/HR Payroll. Paginated, filterable. */
  @Get('appraisal_requests')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.HR_PAYROLL, ROLES.SECRETARY)
  findAll(
    @Query() query: ListAppraisalQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appraisalService.findAll(query, user);
  }

  /** GET /api/v1/appraisal/:id — Faculty (own only)/HoD/HR Payroll. */
  @Get('appraisal_requests/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.HR_PAYROLL, ROLES.SECRETARY)
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appraisalService.findOne(id, user);
  }

  /** PATCH /api/v1/appraisal/:id — HoD (review) or HR Payroll (scoring/approval) only. */
  @Patch('appraisal_requests/:id')
  @Roles(ROLES.HOD, ROLES.HR_PAYROLL)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAppraisalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appraisalService.update(id, dto, user);
  }

  /** DELETE /api/v1/appraisal/:id — Faculty or HoD, own request, only while still 'submitted'. */
  @Delete('appraisal_requests/:id')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.SECRETARY)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appraisalService.remove(id, user.sub, user.role);
  }

  /**
   * POST /api/v1/appraisal_requests/:id/attachments — Faculty only, own
   * request, only while still 'submitted'. multipart/form-data: up to 5
   * files (field name "files", 10MB each) plus a "division_id" text field.
   */
  @Post('appraisal_requests/:id/attachments')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  @UseInterceptors(
    FilesInterceptor('files', MAX_ATTACHMENT_FILES, {
      limits: { fileSize: MAX_ATTACHMENT_FILE_SIZE_BYTES },
    }),
  )
  addAttachments(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UploadAppraisalAttachmentDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appraisalService.addAttachments(
      id,
      dto.division_id,
      files,
      user.sub,
    );
  }

  /** DELETE /api/v1/appraisal_requests/:id/attachments/:attachmentId — Faculty or HoD, own request, only while still 'submitted'. */
  @Delete('appraisal_requests/:id/attachments/:attachmentId')
  @Roles(ROLES.FACULTY, ROLES.HOD)
  removeAttachment(
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appraisalService.removeAttachment(id, attachmentId, user.sub);
  }
}
