import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HigherEducationUniversitiesService } from './higher-education-universities.service';
import { CreateUniversityDto } from './dto/create-university.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HIGHER_EDUCATION)
export class HigherEducationUniversitiesController {
  constructor(private readonly service: HigherEducationUniversitiesService) {}

  /** GET /api/v1/me/higher-education-universities — the university partner register. */
  @Get('higher-education-universities')
  getUniversities() {
    return this.service.getUniversities();
  }

  /** POST /api/v1/me/higher-education-universities — add a university to the register. */
  @Post('higher-education-universities')
  @HttpCode(HttpStatus.CREATED)
  createUniversity(@Body() dto: CreateUniversityDto) {
    return this.service.createUniversity(dto);
  }
}
