import {
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
import { ListDocumentsQueryDto } from 'src/modules/secretary-portal/documents/dto/list-documents-query.dto';
import { IqacApprovalsService } from './iqac-approvals.service';

/**
 * GET/PATCH /api/v1/me/iqac/approvals/* — IQAC only.
 *
 * Delegates straight to IqacApprovalsService, which itself delegates to
 * DocumentsService — the real department_documents register Secretary
 * Portal's own "Department Document Management" screen already uses, not
 * a duplicate. This is the one IQAC route in the whole module that writes:
 * verifying a departmental submission is IQAC's actual job, unlike every
 * other page here which stays read-only. The reference design's Approve/
 * Reject pair doesn't map onto the real department_document_status_enum
 * (pending/verified/missing — no "rejected" state exists), so this
 * exposes the real pending↔verified toggle instead: "Approve" for a
 * pending row, "Reopen" for a verified one.
 */
@Controller('me/iqac/approvals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC)
export class IqacApprovalsController {
  constructor(private readonly approvals: IqacApprovalsService) {}

  @Get('stats')
  stats(@CurrentUser() user: JwtPayload) {
    return this.approvals.stats(user);
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query() query: ListDocumentsQueryDto) {
    return this.approvals.findAll(user, query);
  }

  @Patch(':id/verify')
  toggleVerify(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.approvals.toggleVerify(user, id, user.sub);
  }
}
