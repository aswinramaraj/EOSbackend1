import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';

/**
 * Department-wide document register — backs the Secretary Portal's
 * "Department Document Management" screen. Institution-wide for
 * Secretary/Admin/Principal (no secretary→department table exists).
 */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB, same cap as announcements

@Controller('me/department-documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SECRETARY, ROLES.ADMIN, ROLES.PRINCIPAL)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /** POST /me/department-documents/attachments — real upload; call before create(). */
  @Post('attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  uploadAttachment(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({ message: 'No file was uploaded (expected multipart field "file")', errorCode: 'VALIDATION_ERROR' });
    }
    return this.documentsService.uploadAttachment(file);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateDocumentDto, @CurrentUser() user: JwtPayload) {
    return this.documentsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: ListDocumentsQueryDto) {
    return this.documentsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.documentsService.findOne(id);
  }

  @Patch(':id/verify')
  toggleVerify(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.documentsService.toggleVerify(id, user.sub);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.documentsService.remove(id);
  }
}
