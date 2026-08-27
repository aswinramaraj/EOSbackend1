import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { AccreditationService } from 'src/modules/secretary-portal/accreditation/accreditation.service';
import { CreateAccreditationItemDto } from './dto/create-accreditation-item.dto';
import { IqacAccreditationService } from './iqac-accreditation.service';

/**
 * GET /api/v1/me/iqac/accreditation/* — IQAC only.
 *
 * `nba-overview` delegates straight to AccreditationService (Secretary
 * Portal's real nba_criteria/nba_evidence_items data), read-only — no
 * create/toggle route: editing NBA evidence is Secretary/Admin/Principal's
 * job, not IQAC's oversight view. `naac`/`aqar`/`ssr` are real
 * iqac_accreditation_criteria rows IQAC owns directly (see
 * IqacAccreditationService), including the "+ Add item" write action.
 */
@Controller('me/iqac/accreditation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC)
export class IqacAccreditationController {
  constructor(
    private readonly accreditation: AccreditationService,
    private readonly iqacAccreditation: IqacAccreditationService,
  ) {}

  @Get('nba-overview')
  getOverview(@CurrentUser() user: JwtPayload, @Query('department_id') departmentId?: string) {
    return this.accreditation.getOverview(
      user,
      departmentId ? Number(departmentId) : undefined,
    );
  }

  @Get('naac')
  naacItems(@Query('department_id') departmentId?: string) {
    return this.iqacAccreditation.items(
      'naac',
      departmentId ? Number(departmentId) : undefined,
    );
  }

  @Post('naac')
  createNaacItem(@Body() dto: CreateAccreditationItemDto) {
    return this.iqacAccreditation.createItem('naac', dto);
  }

  @Get('aqar')
  aqarItems(@Query('department_id') departmentId?: string) {
    return this.iqacAccreditation.items(
      'aqar',
      departmentId ? Number(departmentId) : undefined,
    );
  }

  @Post('aqar')
  createAqarItem(@Body() dto: CreateAccreditationItemDto) {
    return this.iqacAccreditation.createItem('aqar', dto);
  }

  @Get('ssr')
  ssrItems(@Query('department_id') departmentId?: string) {
    return this.iqacAccreditation.items(
      'ssr',
      departmentId ? Number(departmentId) : undefined,
    );
  }

  @Post('ssr')
  createSsrItem(@Body() dto: CreateAccreditationItemDto) {
    return this.iqacAccreditation.createItem('ssr', dto);
  }
}
