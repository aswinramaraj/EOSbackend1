import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodEmployeeLibraryService } from './hod-employee-library.service';

@Controller('hod/employee/library')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodEmployeeLibraryController {
  constructor(
    private readonly hodEmployeeLibraryService: HodEmployeeLibraryService,
  ) {}

  /** GET /api/v1/hod/employee/library */
  @Get()
  getOverview(@CurrentUser() user: JwtPayload) {
    return this.hodEmployeeLibraryService.getOverview(user.sub);
  }

  /** PATCH /api/v1/hod/employee/library/:id/renew */
  @Patch(':id/renew')
  renew(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.hodEmployeeLibraryService.renew(user.sub, id);
  }

  /** POST /api/v1/hod/employee/library/request */
  @Post('request')
  requestBook(
    @CurrentUser() user: JwtPayload,
    @Body('book_id', ParseIntPipe) bookId: number,
  ) {
    return this.hodEmployeeLibraryService.requestBook(user.sub, bookId);
  }
}
