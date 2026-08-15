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
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { ProfileService } from './profile.service';
import { CreateSocialLinkDto } from './dto/create-social-link.dto';

const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB

// Profile & Resume screen — the base GET/social-links routes are open to
// every role that has a real self-view here (Student, Faculty, HoD, HR
// Payroll, Parent). There is deliberately no photo-upload endpoint here -
// profile photos (students.photo_url / faculty.profile_url) are set only
// by an admin directly in the DB; every role can view their photo but none
// can change it from the app. Resume upload and the ID card only apply to
// roles that actually have those concepts in the schema (not Parent - see
// ProfileService.getParentProfile) - guarded per-method instead of at the
// class level for that reason.
@Controller('me/my-profile')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /** GET /api/v1/me/my-profile */
  @Get()
  @Roles(
    ROLES.STUDENT,
    ROLES.FACULTY,
    ROLES.HOD,
    ROLES.HR_PAYROLL,
    ROLES.PARENT,
    ROLES.PRINCIPAL,
  )
  getMyProfile(@CurrentUser() user: JwtPayload) {
    return this.profileService.getMyProfile(user);
  }

  /** POST /api/v1/me/my-profile/resume */
  @Post('resume')
  @Roles(ROLES.STUDENT, ROLES.FACULTY, ROLES.HOD, ROLES.HR_PAYROLL)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_RESUME_BYTES } }),
  )
  uploadResume(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) {
      throw new BadRequestException({
        message: 'No file was uploaded (expected multipart field "file")',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return this.profileService.uploadResume(user, file);
  }

  /** POST /api/v1/me/my-profile/social-links */
  @Post('social-links')
  @Roles(
    ROLES.STUDENT,
    ROLES.FACULTY,
    ROLES.HOD,
    ROLES.HR_PAYROLL,
    ROLES.PARENT,
  )
  @HttpCode(HttpStatus.CREATED)
  addSocialLink(
    @Body() dto: CreateSocialLinkDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.profileService.addSocialLink(user, dto);
  }

  /** DELETE /api/v1/me/my-profile/social-links/:id */
  @Delete('social-links/:id')
  @Roles(
    ROLES.STUDENT,
    ROLES.FACULTY,
    ROLES.HOD,
    ROLES.HR_PAYROLL,
    ROLES.PARENT,
  )
  removeSocialLink(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.profileService.removeSocialLink(user, id);
  }

  /** GET /api/v1/me/my-profile/id-card */
  @Get('id-card')
  @Roles(ROLES.STUDENT, ROLES.FACULTY, ROLES.HOD, ROLES.HR_PAYROLL)
  getIdCard(@CurrentUser() user: JwtPayload) {
    return this.profileService.getIdCard(user);
  }

  /** POST /api/v1/me/my-profile/id-card/issue — called once per ID-card generation. */
  @Post('id-card/issue')
  @Roles(ROLES.STUDENT, ROLES.FACULTY, ROLES.HOD, ROLES.HR_PAYROLL)
  @HttpCode(HttpStatus.CREATED)
  issueIdCard(@CurrentUser() user: JwtPayload) {
    return this.profileService.issueIdCard(user);
  }
}
