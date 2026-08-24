import {
  Body,
  Controller,
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
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { OdService } from './od.service';
import { CreateOdRequestDto } from './dto/create-od-request.dto';
import { SearchOdRequestsDto } from './dto/search-od-requests.dto';

@Controller('sports-admin/od-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SPORTS_ADMIN, ROLES.ADMIN, ROLES.HOD)
export class OdController {
  constructor(private readonly odService: OdService) {}

  @Get()
  findAll(@Query() query: SearchOdRequestsDto) {
    return this.odService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateOdRequestDto, @CurrentUser() user: JwtPayload) {
    return this.odService.create(dto, user.sub);
  }

  /**
   * GET /sports-admin/od-requests/hod-queue — what is waiting on this HoD.
   *
   * MUST stay above @Get(':id'): Nest matches in declaration order, so a
   * parameterised route declared first would swallow this literal segment and
   * ParseIntPipe would reject "hod-queue" as a bad id.
   */
  @Get('hod-queue')
  @Roles(ROLES.HOD, ROLES.ADMIN)
  hodQueue(@CurrentUser() user: JwtPayload) {
    return this.odService.hodQueue(user.sub);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.odService.findOne(id);
  }

  /** GET /sports-admin/od-requests/:id/approvals — per-department state. */
  @Get(':id/approvals')
  approvals(@Param('id', ParseIntPipe) id: number) {
    return this.odService.approvals(id);
  }

  /**
   * Decided by the HoD of each department in the squad — never by Sports,
   * which is the party raising the request. A method-level @Roles overrides
   * the class-level list, so Sports cannot reach these routes.
   */
  @Post(':id/approve')
  @Roles(ROLES.HOD, ROLES.ADMIN)
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Body('remarks') remarks: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.odService.approve(id, user.sub, remarks);
  }

  @Post(':id/reject')
  @Roles(ROLES.HOD, ROLES.ADMIN)
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body('remarks') remarks: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.odService.reject(id, user.sub, remarks);
  }
}
