import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HigherEducationScholarshipsService } from './higher-education-scholarships.service';
import { CreateSchemeDto } from './dto/create-scheme.dto';
import { UpdateSchemeDto } from './dto/update-scheme.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HIGHER_EDUCATION)
export class HigherEducationScholarshipsController {
  constructor(private readonly service: HigherEducationScholarshipsService) {}

  /** GET /api/v1/me/higher-education-scholarships — funded aspirants, the scheme register, funding mix and education loans. */
  @Get('higher-education-scholarships')
  getScholarships() {
    return this.service.getScholarships();
  }

  /** POST /api/v1/me/higher-education-scholarship-schemes — add a scheme to the register. */
  @Post('higher-education-scholarship-schemes')
  @HttpCode(HttpStatus.CREATED)
  createScheme(@Body() dto: CreateSchemeDto) {
    return this.service.createScheme(dto);
  }

  /** PATCH /api/v1/me/higher-education-scholarship-schemes/:id — edit a scheme. */
  @Patch('higher-education-scholarship-schemes/:id')
  updateScheme(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSchemeDto,
  ) {
    return this.service.updateScheme(id, dto);
  }

  /** DELETE /api/v1/me/higher-education-scholarship-schemes/:id */
  @Delete('higher-education-scholarship-schemes/:id')
  deleteScheme(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteScheme(id);
  }
}
