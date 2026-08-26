import {
  Controller,
  Get,
  Query,
  Body,
  Post,
  Patch,
  Param,
  ParseIntPipe,
  Delete,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EResourcesService } from './e-resources.service';
import { SearchEResourcesDto } from './dto/search-e-resources.dto';
import { CreateEResourceDto } from './dto/create-e-resource.dto';
import { CreateEResourceFileDto } from './dto/create-e-resource-file.dto';
import { UpdateEResourceDto } from './dto/update-e-resource.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { FuzzySearchDto } from 'src/common';

const MAX_E_RESOURCE_BYTES = 50 * 1024 * 1024; // 50 MB — e-books/PDFs run larger than the 10MB doc-attachment cap used elsewhere.

@Controller('library/e-resources')
export class EResourcesController {
  constructor(private readonly eResourcesService: EResourcesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Query() query: SearchEResourcesDto) {
    return this.eResourcesService.findAll(query);
  }

  // Must come before ':id' — otherwise Nest would try to match "search" as an :id param.
  @UseGuards(JwtAuthGuard)
  @Get('search')
  searchFuzzy(@Query() query: FuzzySearchDto) {
    return this.eResourcesService.searchFuzzy(query.q, query.limit);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.eResourcesService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Post()
  create(@Body() dto: CreateEResourceDto, @CurrentUser() user: JwtPayload) {
    return this.eResourcesService.create(dto, user.sub);
  }

  /**
   * POST /library/e-resources/upload — multipart, `file` required. The
   * actual PDF/EPUB/etc is uploaded to storage server-side and its public
   * URL, format and size are derived from the file itself, so the librarian
   * never has to type a link or a byte count by hand.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_E_RESOURCE_BYTES } }),
  )
  createFromFile(
    @Body() dto: CreateEResourceFileDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.eResourcesService.createFromFile(dto, file, user.sub);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEResourceDto,
  ) {
    return this.eResourcesService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('library', 'admin')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.eResourcesService.remove(id);
  }
}
