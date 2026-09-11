import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
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
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';
import { ScriptArchiveService } from './script-archive.service';
import { ArchiveBundleDto } from './dto/archive-bundle.dto';
import { CreateRetrievalDto } from './dto/create-retrieval.dto';
import { ListArchiveQueryDto } from './dto/list-archive-query.dto';

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024; // 10 MB, same cap used by every other real upload in this codebase

@Controller('script-archive')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class ScriptArchiveController {
  constructor(private readonly service: ScriptArchiveService) {}

  @Get('stats')
  async getStats() {
    const stats = await this.service.getStats();
    return ApiResponse.ok(stats, 'Archive stats fetched successfully.');
  }

  @Get('requesters')
  async listRequesterSuggestions() {
    const requesters = await this.service.listRequesterSuggestions();
    return ApiResponse.ok(
      requesters,
      'Requester suggestions fetched successfully.',
    );
  }

  @Get()
  async findAll(@Query() query: ListArchiveQueryDto) {
    const rows = await this.service.findAll(query);
    return ApiResponse.ok(rows, 'Archive bundles fetched successfully.');
  }

  @Post()
  async archiveBundle(@Body() dto: ArchiveBundleDto) {
    const archived = await this.service.archiveBundle(dto);
    return ApiResponse.created(archived, 'Bundle archived successfully.');
  }

  /** POST /script-archive/retrieval/attachments — real Supabase-Storage upload for a scanned fee receipt; returns {url} to send back as fee_receipt_url on the actual retrieval create call. */
  @Post('retrieval/attachments')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_RECEIPT_BYTES } }),
  )
  async uploadFeeReceipt(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({
        message: 'No file was uploaded (expected multipart field "file")',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    const result = await this.service.uploadFeeReceipt(file);
    return ApiResponse.created(result, 'Fee receipt uploaded successfully.');
  }

  @Post('retrieval')
  async createRetrieval(
    @Body() dto: CreateRetrievalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const retrieval = await this.service.createRetrieval(dto, user.sub);
    return ApiResponse.created(
      retrieval,
      'Retrieval request recorded successfully.',
    );
  }

  @Post(':id/recall')
  async recall(@Param('id', ParseIntPipe) id: number) {
    const result = await this.service.recall(id);
    return ApiResponse.ok(result, 'Bundle recalled to archive successfully.');
  }
}
