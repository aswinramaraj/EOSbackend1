import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
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
import { ROLES } from 'src/common/constants/roles.constant';
import { HrQueriesService } from './hr-queries.service';
import { CreateHrQueryDto } from './dto/create-hr-query.dto';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

@Controller('me/hr-queries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  ROLES.FACULTY,
  ROLES.SECRETARY,
  ROLES.HOD,
  // HR Payroll and warden are employees who raise their own HR tickets.
  // Omitting them meant the mobile "HR Payroll" self-service tile 403d for
  // exactly the roles that reach it from their own dashboard.
  ROLES.HR_PAYROLL,
  ROLES.WARDEN,
)
export class HrQueriesController {
  constructor(private readonly hrQueriesService: HrQueriesService) {}

  /** POST /api/v1/me/hr-queries — multipart, `file` optional. Faculty + Secretary. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }),
  )
  create(
    @Body() dto: CreateHrQueryDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hrQueriesService.create(dto, user.sub, file);
  }

  /** GET /api/v1/me/hr-queries — own queries only. */
  @Get()
  findMine(@CurrentUser() user: JwtPayload) {
    return this.hrQueriesService.findMine(user.sub);
  }
}
