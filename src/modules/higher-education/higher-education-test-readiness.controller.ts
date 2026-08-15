import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HigherEducationTestReadinessService } from './higher-education-test-readiness.service';
import { CreateTestDto } from './dto/create-test.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HIGHER_EDUCATION)
export class HigherEducationTestReadinessController {
  constructor(private readonly service: HigherEducationTestReadinessService) {}

  /** GET /api/v1/me/higher-education-test-readiness — per-test summary, upcoming windows, coaching batches and retake watchlist. */
  @Get('higher-education-test-readiness')
  getTestReadiness() {
    return this.service.getTestReadiness();
  }

  /** POST /api/v1/me/higher-education-test-register — add/update a test's register entry. */
  @Post('higher-education-test-register')
  @HttpCode(HttpStatus.CREATED)
  createTest(@Body() dto: CreateTestDto) {
    return this.service.createTest(dto);
  }
}
