import {
  BadRequestException,
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { StudentsService } from './students.service';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { AdminUpdateStudentDto } from './dto/admin-update-student.dto';
import { AdminAttendanceSummaryQueryDto } from './dto/admin-attendance-summary-query.dto';
import { ResetStudentPasswordDto } from './dto/reset-student-password.dto';
import { UpdateStudentAddressesDto } from './dto/update-student-addresses.dto';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * No POST here — creation stays exclusively through
 * soa-applications/:id/perfect-entry, which already handles the linked user
 * account, duplicate checks and conditional business rules correctly.
 */
@Controller('students')
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  findAll(@Query() query: ListStudentsQueryDto) {
    return this.studentsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.findOne(id);
  }

  @Get(':id/attendance-summary')
  getAttendanceSummary(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AdminAttendanceSummaryQueryDto,
  ) {
    return this.studentsService.getAttendanceSummary(id, query);
  }

  @Get(':id/attendance-by-semester')
  getAttendanceBySemester(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getAttendanceBySemester(id);
  }

  @Get(':id/profile-details')
  getProfileDetails(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getProfileDetails(id);
  }

  @Get(':id/family')
  getFamily(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getFamily(id);
  }

  @Get(':id/lifecycle')
  getLifecycle(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getLifecycle(id);
  }

  @Get(':id/subjects')
  getSubjects(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getSubjects(id);
  }

  @Get(':id/requests')
  getRequests(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getRequests(id);
  }

  @Get(':id/announcements')
  getAnnouncements(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getAnnouncements(id);
  }

  @Get(':id/certificates')
  getCertificates(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getCertificates(id);
  }

  @Get(':id/transport')
  getTransport(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getTransport(id);
  }

  @Get(':id/medical')
  getMedicalVisits(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getMedicalVisits(id);
  }

  @Get(':id/edit-profile')
  getEditProfile(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.getEditProfile(id);
  }

  /** PATCH /students/:id/addresses — fix an address after admission (see StudentsService.updateAddresses). */
  @Patch(':id/addresses')
  updateAddresses(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentAddressesDto,
  ) {
    return this.studentsService.updateAddresses(id, dto);
  }

  /** POST /students/:id/photo (multipart, field "file") — change/replace an existing student's photo. */
  @Post(':id/photo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }),
  )
  uploadPhoto(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({
        message: 'No file was uploaded (expected multipart field "file")',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return this.studentsService.uploadPhoto(id, file);
  }

  /** DELETE /students/:id/photo — remove an existing student's photo. */
  @Delete(':id/photo')
  deletePhoto(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.deletePhoto(id);
  }

  /**
   * POST /students/:id/reset-password — for a student who forgot their
   * password. Requires the calling admin's own password as a step-up
   * confirmation (see ResetStudentPasswordDto).
   */
  @Post(':id/reset-password')
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetStudentPasswordDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.studentsService.resetPassword(id, dto, admin.sub);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminUpdateStudentDto,
  ) {
    return this.studentsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.studentsService.remove(id);
  }
}
