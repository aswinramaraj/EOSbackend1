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
import { UploadFacultyOdAttachmentDto } from './dto/upload-faculty-od-attachment.dto';
import { VerifyFacultyOdDto } from './dto/verify-faculty-od.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacultyOdController {
  constructor(private readonly facultyOdService: FacultyOdService) {}

  /** POST /api/v1/me/create-od — Faculty only, for the caller's own record. */
  @Post('create-od')
  @Roles(ROLES.FACULTY)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateFacultyOdDto, @CurrentUser() user: JwtPayload) {
    return this.facultyOdService.create(dto, user.sub);
  }

  /** GET /api/v1/me/faculty-od — Faculty (own only)/HoD/HR Payroll/IQAC. Paginated, filterable. */
  @Get('faculty-od')
  @Roles(ROLES.FACULTY, ROLES.HOD, ROLES.HR_PAYROLL, ROLES.IQAC)
  findAll(
    @Query() query: ListFacultyOdQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyOdService.findAll(query, user);
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
}
