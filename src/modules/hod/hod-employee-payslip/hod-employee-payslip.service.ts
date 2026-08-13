import { Injectable } from '@nestjs/common';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { PayslipRequestsService } from 'src/modules/faculty/payslip-requests/payslip-requests.service';
import { CreatePayslipRequestDto } from 'src/modules/faculty/payslip-requests/dto/create-payslip-request.dto';

const FETCH_LIMIT = 100;

@Injectable()
export class HodEmployeePayslipService {
  constructor(
    private readonly payslipRequestsService: PayslipRequestsService,
  ) {}

  /** POST /hod/employee/payslip — self-service, same create path any faculty (HOD included) already uses. */
  async apply(userId: number, dto: CreatePayslipRequestDto) {
    return this.payslipRequestsService.create(dto, userId);
  }

  /** GET /hod/employee/payslip/history — the HOD's own submitted requests only. */
  async getHistory(userId: number) {
    const currentUser: JwtPayload = {
      sub: userId,
      role: ROLES.FACULTY,
      email: '',
      roleId: 0,
    };
    const result = await this.payslipRequestsService.findAll(
      { page: 1, limit: FETCH_LIMIT, skip: 0 },
      currentUser,
    );
    return result.data;
  }
}
