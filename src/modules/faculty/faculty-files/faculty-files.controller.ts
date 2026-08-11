import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { FacultyFilesService } from './faculty-files.service';
import { UploadDocumentDto } from './dto/upload-document.dto';

const memoryUpload = { storage: memoryStorage() };

/**
 * Profile photo + document uploads (Admin/HR Payroll) for a faculty record.
 * File bytes always flow through StorageProvider (see src/modules/storage/)
 * — nothing here talks to Supabase (or any storage vendor) directly.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('me/faculty')
export class FacultyFilesController {
  constructor(private readonly filesService: FacultyFilesService) {}

  @Post(':id/photo')
  @Roles(ROLES.ADMIN, ROLES.HR_PAYROLL)
  @UseInterceptors(FileInterceptor('file', memoryUpload))
  uploadPhoto(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.filesService.uploadPhoto(id, file);
  }

  @Delete(':id/photo')
  @Roles(ROLES.ADMIN, ROLES.HR_PAYROLL)
  removePhoto(@Param('id', ParseIntPipe) id: number) {
    return this.filesService.removePhoto(id);
  }

  @Get(':id/documents')
  @Roles(ROLES.ADMIN, ROLES.HOD, ROLES.HR_PAYROLL)
  listDocuments(@Param('id', ParseIntPipe) id: number) {
    return this.filesService.listDocuments(id);
  }

  @Post(':id/documents')
  @Roles(ROLES.ADMIN, ROLES.HR_PAYROLL)
  @UseInterceptors(FileInterceptor('file', memoryUpload))
  uploadDocument(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.filesService.uploadDocument(
      id,
      file,
      dto.document_type,
      user.sub,
    );
  }

  @Delete(':id/documents/:documentId')
  @Roles(ROLES.ADMIN, ROLES.HR_PAYROLL)
  deleteDocument(
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) documentId: number,
  ) {
    return this.filesService.deleteDocument(id, documentId);
  }
}
