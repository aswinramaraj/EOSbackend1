import { Injectable } from '@nestjs/common';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { AppraisalService } from 'src/modules/faculty/appraisal/appraisal.service';
import { CreateAppraisalDto } from 'src/modules/faculty/appraisal/dto/create-appraisal.dto';
import { ListAppraisalCriteriaQueryDto } from 'src/modules/faculty/appraisal/dto/list-appraisal-criteria-query.dto';

const FETCH_LIMIT = 100;

@Injectable()
export class HodEmployeeAppraisalService {
  constructor(private readonly appraisalService: AppraisalService) {}

  /** GET /hod/employee/appraisal/criteria?academic_year= — reference data for the Apply form. */
  async getCriteria(query: ListAppraisalCriteriaQueryDto) {
    return this.appraisalService.findCriteria(query);
  }

  /** POST /hod/employee/appraisal — self-service, same create path any faculty (HOD included) already uses. */
  async apply(userId: number, dto: CreateAppraisalDto) {
    return this.appraisalService.create(dto, userId);
  }

  /** GET /hod/employee/appraisal/history — the HOD's own submitted requests only. */
  async getHistory(userId: number) {
    const currentUser: JwtPayload = {
      sub: userId,
      role: ROLES.FACULTY,
      email: '',
      roleId: 0,
    };
    const result = await this.appraisalService.findAll(
      { page: 1, limit: FETCH_LIMIT, skip: 0 },
      currentUser,
    );
    return result.data;
  }
}
