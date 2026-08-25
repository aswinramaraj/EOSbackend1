import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';
import { ScriptArchiveService } from './script-archive.service';
import { ArchiveBundleDto } from './dto/archive-bundle.dto';
import { CreateRetrievalDto } from './dto/create-retrieval.dto';

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

  @Get()
  async findAll(@Query('status') status?: 'in_archive' | 'issued_out' | 'due_disposal') {
    const rows = await this.service.findAll(status);
    return ApiResponse.ok(rows, 'Archive bundles fetched successfully.');
  }

  @Post()
  async archiveBundle(@Body() dto: ArchiveBundleDto) {
    const archived = await this.service.archiveBundle(dto);
    return ApiResponse.created(archived, 'Bundle archived successfully.');
  }

  @Post('retrieval')
  async createRetrieval(@Body() dto: CreateRetrievalDto, @CurrentUser() user: JwtPayload) {
    const retrieval = await this.service.createRetrieval(dto, user.sub);
    return ApiResponse.created(retrieval, 'Retrieval request recorded successfully.');
  }

  @Post(':id/recall')
  async recall(@Param('id', ParseIntPipe) id: number) {
    const result = await this.service.recall(id);
    return ApiResponse.ok(result, 'Bundle recalled to archive successfully.');
  }
}
