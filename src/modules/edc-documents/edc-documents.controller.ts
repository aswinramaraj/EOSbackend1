import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { EdcDocumentsService } from './edc-documents.service';
import { CreateEdcDocumentDto } from './dto/create-edc-document.dto';
import { ReviewEdcDocumentDto } from './dto/review-edc-document.dto';

/** EDC Coordinator's Documents screen — real `edc_documents` table, added
 * this session. File upload itself reuses the existing
 * POST /announcements/attachments endpoint (same Supabase Storage
 * plumbing) — this controller only manages the resulting record. */
@Controller('me/edc-documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.EDC_COORDINATOR)
export class EdcDocumentsController {
  constructor(private readonly service: EdcDocumentsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateEdcDocumentDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id/review')
  review(@Param('id', ParseIntPipe) id: number, @Body() dto: ReviewEdcDocumentDto, @CurrentUser() user: JwtPayload) {
    return this.service.review(id, dto, user.sub);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
