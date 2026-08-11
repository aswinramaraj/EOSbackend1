import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { HrRequestsService } from './hr-requests.service';
import { ListHrRequestsQueryDto } from './dto/list-hr-requests-query.dto';
import { CreateHrVacationEntryDto } from './dto/create-hr-vacation-entry.dto';

/** HR's unified leave + OD inbox — HR Payroll only. */
@Controller('hr/requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HR_PAYROLL)
export class HrRequestsController {
  constructor(private readonly hrRequestsService: HrRequestsService) {}

  /** GET /api/v1/hr/requests — merged, filterable, paginated. */
  @Get()
  findAll(@Query() query: ListHrRequestsQueryDto) {
    return this.hrRequestsService.findAll(query);
  }

  /**
   * POST /api/v1/hr/requests — HR recording a single-day leave/OD entry
   * directly for a faculty member (e.g. from the Vacation Management
   * calendar), rather than the faculty member submitting it themselves.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateHrVacationEntryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hrRequestsService.createEntry(dto, user.sub);
  }

  /** DELETE /api/v1/hr/requests/:kind/:id — removes a single leave/OD row. */
  @Delete(':kind/:id')
  remove(@Param('kind') kind: string, @Param('id', ParseIntPipe) id: number) {
    if (kind !== 'leave' && kind !== 'od') {
      throw new BadRequestException('kind must be "leave" or "od"');
    }
    return this.hrRequestsService.removeEntry(kind, id);
  }
}
