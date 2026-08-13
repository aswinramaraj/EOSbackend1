import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { CreateAppraisalDto } from 'src/modules/faculty/appraisal/dto/create-appraisal.dto';
import { ListAppraisalCriteriaQueryDto } from 'src/modules/faculty/appraisal/dto/list-appraisal-criteria-query.dto';
import { HodEmployeeAppraisalService } from './hod-employee-appraisal.service';

@Controller('hod/employee/appraisal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodEmployeeAppraisalController {
  constructor(
    private readonly hodEmployeeAppraisalService: HodEmployeeAppraisalService,
  ) {}

  /** GET /api/v1/hod/employee/appraisal/criteria?academic_year= */
  @Get('criteria')
  getCriteria(@Query() query: ListAppraisalCriteriaQueryDto) {
    return this.hodEmployeeAppraisalService.getCriteria(query);
  }

  /** GET /api/v1/hod/employee/appraisal/history */
  @Get('history')
  getHistory(@CurrentUser() user: JwtPayload) {
    return this.hodEmployeeAppraisalService.getHistory(user.sub);
  }

  /** POST /api/v1/hod/employee/appraisal */
  @Post()
  apply(@CurrentUser() user: JwtPayload, @Body() dto: CreateAppraisalDto) {
    return this.hodEmployeeAppraisalService.apply(user.sub, dto);
  }
}
