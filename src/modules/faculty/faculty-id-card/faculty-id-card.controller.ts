import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { FacultyIdCardService } from './faculty-id-card.service';
import { ListIdCardStatusQueryDto } from './dto/list-id-card-status-query.dto';

@Controller('me/faculty')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacultyIdCardController {
  constructor(private readonly facultyIdCardService: FacultyIdCardService) {}

  /**
   * GET /api/v1/me/faculty/id-card/status?faculty_ids=1,2,3 — Admin only.
   * Declared before the :id route below (same reasoning as the attendance
   * overview route) so this literal path is never mistaken for :id/id-card.
   */
  @Get('id-card/status')
  @Roles(ROLES.ADMIN)
  getBulkStatus(@Query() query: ListIdCardStatusQueryDto) {
    return this.facultyIdCardService.getBulkStatus(query.faculty_ids);
  }

  /** GET /api/v1/me/faculty/:id/id-card — Admin only. */
  @Get(':id/id-card')
  @Roles(ROLES.ADMIN)
  getStatus(@Param('id', ParseIntPipe) id: number) {
    return this.facultyIdCardService.getStatus(id);
  }

  /** POST /api/v1/me/faculty/:id/id-card/issue — Admin only. */
  @Post(':id/id-card/issue')
  @Roles(ROLES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  issue(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.facultyIdCardService.issue(id, user.sub);
  }
}
