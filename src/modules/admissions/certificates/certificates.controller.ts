import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { CertificatesService } from './certificates.service';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/**
 * Admission document checklist — the "documents" feature the admit wizard
 * and student profile both use. Read access to a single student's own
 * checklist stays on GET /students/:id/certificates (students.service.ts);
 * this controller is the write side (attach a scan, tick collected, verify).
 */
@Controller()
@Roles(ROLES.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  /** GET /certificate-types — the real, DB-backed checklist item list. */
  @Get('certificate-types')
  listTypes() {
    return this.certificatesService.listTypes();
  }

  /** POST /certificates (multipart, field "file" optional) */
  @Post('certificates')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }),
  )
  create(
    @Body() dto: CreateCertificateDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file && !file.buffer) {
      throw new BadRequestException({
        message: 'Uploaded file was empty',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    return this.certificatesService.create(dto, file);
  }

  /** PATCH /certificates/:id */
  @Patch('certificates/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCertificateDto,
  ) {
    return this.certificatesService.update(id, dto);
  }
}
