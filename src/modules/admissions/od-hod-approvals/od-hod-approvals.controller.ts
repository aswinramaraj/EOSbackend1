import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { OdHodApprovalsService } from './od-hod-approvals.service';
import { ListOdHodApprovalQueryDto } from './dto/list-od-hod-approval-query.dto';
import { ReviewOdHodApprovalDto } from './dto/review-od-hod-approval.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OdHodApprovalsController {
  constructor(private readonly odHodApprovalsService: OdHodApprovalsService) {}

  /** GET /api/v1/me/od-hod-approvals — HoD only. The HoD's own-department queue. */
  @Get('od-hod-approvals')
  @Roles(ROLES.HOD)
  findAll(
    @Query() query: ListOdHodApprovalQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.odHodApprovalsService.findAll(query, user.sub);
  }

  /** PATCH /api/v1/me/od-hod-approvals/:id — HoD only (their own department). */
  @Patch('od-hod-approvals/:id')
  @Roles(ROLES.HOD)
  review(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewOdHodApprovalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.odHodApprovalsService.review(id, dto, user.sub);
  }
}
