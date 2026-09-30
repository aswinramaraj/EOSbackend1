import {
  Body,
  Controller,
  Delete,
  Get,
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
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ParentAccountsService } from './parent-accounts.service';
import { CreateParentAccountDto } from './dto/create-parent-account.dto';
import { LinkParentAccountDto } from './dto/link-parent-account.dto';
import { SearchParentsQueryDto } from './dto/search-parents-query.dto';

/**
 * /api/v1/students/:id/parents/* and /api/v1/parents/search — Admin only.
 * A separate controller from StudentsController (not a new method there)
 * purely to keep that already-large controller from growing further —
 * same reasoning as MeClassesAttendanceController living apart from
 * AttendanceController.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class ParentAccountsController {
  constructor(private readonly service: ParentAccountsService) {}

  @Get('parents/search')
  search(@Query() query: SearchParentsQueryDto) {
    return this.service.search(query.q);
  }

  @Get('students/:id/parents')
  listForStudent(@Param('id', ParseIntPipe) id: number) {
    return this.service.listForStudent(id);
  }

  @Post('students/:id/parents')
  create(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateParentAccountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(id, dto, user.sub);
  }

  @Post('students/:id/parents/link')
  link(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LinkParentAccountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.link(id, dto, user.sub);
  }

  @Delete('students/:id/parents/:parentUserId')
  unlink(
    @Param('id', ParseIntPipe) id: number,
    @Param('parentUserId', ParseIntPipe) parentUserId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.unlink(id, parentUserId, user.sub);
  }
}
