import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { paginate } from 'src/common/dto/pagination.dto';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateHrPayrollDto } from './dto/create-hr-payroll.dto';
import { UpdateHrPayrollDto } from './dto/update-hr-payroll.dto';
import { ListHrPayrollQueryDto } from './dto/list-hr-payroll-query.dto';

const HR_PAYROLL_SELECT = {
  id: true,
  month: true,
  year: true,
  gross_amount: true,
  net_amount: true,
  paid_at: true,
  faculty: {
    select: {
      id: true,
      prefix: true,
      first_name: true,
      last_name: true,
      designation: true,
    },
  },
  users: { select: { id: true, email: true } },
} as const;

interface HrPayrollRow {
  id: number;
  month: number;
  year: number;
  gross_amount: unknown;
  net_amount: unknown;
  paid_at: Date | null;
  faculty: {
    id: number;
    prefix: string | null;
    first_name: string;
    last_name: string;
    designation: string;
  } | null;
  users: { id: number; email: string } | null;
}

function parseMonthString(month: string): { year: number; month: number } {
  const [yearStr, monthStr] = month.split('-');
  return { year: Number(yearStr), month: Number(monthStr) };
}

function formatMonthString(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function toResponse(row: HrPayrollRow) {
  return {
    id: row.id,
    month: formatMonthString(row.year, row.month),
    year: row.year,
    month_number: row.month,
    // Prisma's Decimal serializes to a string in JSON — convert to a number
    // here so API consumers (the frontend types this as `number`) get a
    // real number.
    gross_amount: Number(row.gross_amount),
    net_amount: Number(row.net_amount),
    paid_at: row.paid_at,
    faculty: row.faculty,
    processed_by: row.users,
  };
}

@Injectable()
export class HrPayrollService {
  private readonly logger = new Logger(HrPayrollService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** POST /hr-payroll (HR Payroll only). */
  async create(dto: CreateHrPayrollDto, currentUserId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: dto.faculty_id },
    });
    if (!faculty) {
      throw new NotFoundException('Faculty not found');
    }

    const { year, month } = parseMonthString(dto.month);

    const existing = await this.prisma.salary_payments.findFirst({
      where: { faculty_id: dto.faculty_id, payee_type: 'faculty', year, month },
    });
    if (existing) {
      throw new ConflictException(
        `A payroll record already exists for faculty ${dto.faculty_id} for ${dto.month}`,
      );
    }

    const { grossAmount, netAmount } = this.computeAmounts(
      dto.basic_salary,
      dto.hra,
      dto.da,
      dto.pf_deduction,
      dto.other_deductions,
    );

    const payroll = await this.prisma.salary_payments.create({
      data: {
        payee_type: 'faculty',
        faculty_id: dto.faculty_id,
        year,
        month,
        gross_amount: grossAmount,
        net_amount: netAmount,
        paid_at: dto.paid_on ? new Date(dto.paid_on) : undefined,
        processed_by_user_id: currentUserId,
      },
      select: HR_PAYROLL_SELECT,
    });

    this.logger.log(
      `Payroll record created: id=${payroll.id} faculty=${dto.faculty_id} month=${dto.month}`,
    );
    return toResponse(payroll);
  }

  /** GET /hr-payroll (HR Payroll/Faculty). Faculty is always scoped to their own records. */
  async findAll(query: ListHrPayrollQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {
      payee_type: 'faculty',
      faculty_id: query.faculty_id,
    };

    if (query.month) {
      const { year, month } = parseMonthString(query.month);
      where.year = year;
      where.month = month;
    }

    if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      where.faculty_id = faculty.id;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.salary_payments.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        select: HR_PAYROLL_SELECT,
      }),
      this.prisma.salary_payments.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /hr-payroll/:id (HR Payroll/Faculty). Faculty may only view their own. */
  async findOne(id: number, currentUser: JwtPayload) {
    const payroll = await this.prisma.salary_payments.findUnique({
      where: { id },
      select: HR_PAYROLL_SELECT,
    });

    if (!payroll || !payroll.faculty) {
      throw new NotFoundException('Payroll record not found');
    }

    if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      if (payroll.faculty.id !== faculty.id) {
        throw new ForbiddenException(
          'You may only view your own payroll records',
        );
      }
    }

    return toResponse(payroll);
  }

  /** PATCH /hr-payroll/:id (HR Payroll only). */
  async update(id: number, dto: UpdateHrPayrollDto, currentUserId: number) {
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException('No fields provided to update');
    }

    const existing = await this.prisma.salary_payments.findUnique({
      where: { id },
    });
    if (!existing || existing.payee_type !== 'faculty') {
      throw new NotFoundException('Payroll record not found');
    }

    const touchedBreakdown =
      dto.basic_salary !== undefined ||
      dto.hra !== undefined ||
      dto.da !== undefined ||
      dto.pf_deduction !== undefined ||
      dto.other_deductions !== undefined;

    const data: {
      gross_amount?: number;
      net_amount?: number;
      paid_at?: Date;
      processed_by_user_id: number;
    } = { processed_by_user_id: currentUserId };

    if (touchedBreakdown) {
      if (
        dto.basic_salary === undefined ||
        dto.hra === undefined ||
        dto.da === undefined ||
        dto.pf_deduction === undefined ||
        dto.other_deductions === undefined
      ) {
        throw new BadRequestException(
          'basic_salary, hra, da, pf_deduction and other_deductions must all be provided together to recompute salary — only the computed gross_amount/net_amount are stored, not the individual breakdown, so an omitted deduction cannot be distinguished from an intentional zero and would otherwise silently reset it',
        );
      }

      const { grossAmount, netAmount } = this.computeAmounts(
        dto.basic_salary,
        dto.hra,
        dto.da,
        dto.pf_deduction,
        dto.other_deductions,
      );
      data.gross_amount = grossAmount;
      data.net_amount = netAmount;
    }

    if (dto.paid_on !== undefined) {
      data.paid_at = new Date(dto.paid_on);
    }

    const payroll = await this.prisma.salary_payments.update({
      where: { id },
      data,
      select: HR_PAYROLL_SELECT,
    });

    return toResponse(payroll);
  }

  private computeAmounts(
    basicSalary: number,
    hra: number,
    da: number,
    pfDeduction?: number,
    otherDeductions?: number,
  ): { grossAmount: number; netAmount: number } {
    const grossAmount = this.round2(basicSalary + hra + da);
    const netAmount = this.round2(
      grossAmount - (pfDeduction ?? 0) - (otherDeductions ?? 0),
    );
    return { grossAmount, netAmount };
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private async resolveFacultyByUserId(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }
}
