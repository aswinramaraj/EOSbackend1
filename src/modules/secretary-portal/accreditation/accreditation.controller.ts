import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { AccreditationService } from './accreditation.service';
import { CreateCriterionDto } from './dto/create-criterion.dto';
import { AddEvidenceItemDto } from './dto/add-evidence-item.dto';

/** Accreditation/NBA — Secretary Portal "Accreditation Documentation" screen. */
@Controller('me/nba')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SECRETARY, ROLES.ADMIN, ROLES.PRINCIPAL)
export class AccreditationController {
  constructor(private readonly accreditationService: AccreditationService) {}

  @Get('overview')
  getOverview(@CurrentUser() user: JwtPayload, @Query('department_id') departmentId?: string) {
    return this.accreditationService.getOverview(user, departmentId ? +departmentId : undefined);
  }

  @Post('criteria')
  @HttpCode(HttpStatus.CREATED)
  createCriterion(@CurrentUser() user: JwtPayload, @Body() dto: CreateCriterionDto) {
    return this.accreditationService.createCriterion(user, dto.department_id, dto.code, dto.name, dto.max_marks);
  }

  @Post('criteria/:id/evidence-items')
  @HttpCode(HttpStatus.CREATED)
  addEvidenceItem(@Param('id', ParseIntPipe) id: number, @Body() dto: AddEvidenceItemDto) {
    return this.accreditationService.addEvidenceItem(id, dto.label);
  }

  @Patch('evidence-items/:id/toggle')
  toggleEvidenceItem(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.accreditationService.toggleEvidenceItem(id, user.sub);
  }
}
