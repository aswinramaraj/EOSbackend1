import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListCertificateRequestsQueryDto } from './dto/list-certificate-requests-query.dto';
import { CreateCertificateRequestDto } from './dto/create-certificate-request.dto';
import { UpdateCertificateStatusDto } from './dto/update-certificate-status.dto';
import { UpdateCertificateFeeDto } from './dto/update-certificate-fee.dto';

const STUDENT_SELECT = {
  id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  classes: {
    select: {
      current_semester: true,
      departments: { select: { id: true, code: true, name: true } },
    },
  },
} as const;

const INCLUDE = {
  students: { select: STUDENT_SELECT },
  certificate_types: { select: { id: true, name: true } },
} as const;

function withNumericFee<T extends { fee_amount: Prisma.Decimal | null }>(row: T) {
  return { ...row, fee_amount: row.fee_amount != null ? Number(row.fee_amount) : null };
}

@Injectable()
export class CertificateRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListCertificateRequestsQueryDto) {
    const where: Prisma.certificate_requestsWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.students = {
        OR: [
          { student_id_no: { contains: query.search, mode: 'insensitive' } },
          { register_no: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    const rows = await this.prisma.certificate_requests.findMany({
      where,
      include: INCLUDE,
      orderBy: { requested_at: 'desc' },
    });
    return rows.map(withNumericFee);
  }

  async getStats() {
    const [pending, readyToPrint, printed, issued, feeUnpaid] = await Promise.all([
      this.prisma.certificate_requests.count({ where: { status: 'pending' } }),
      this.prisma.certificate_requests.count({ where: { status: 'ready_to_print' } }),
      this.prisma.certificate_requests.count({ where: { status: 'printed' } }),
      this.prisma.certificate_requests.count({ where: { status: 'issued' } }),
      this.prisma.certificate_requests.count({ where: { fee_paid: false } }),
    ]);

    return { pending, ready_to_print: readyToPrint, printed, issued, fee_unpaid: feeUnpaid };
  }

  async listCertificateTypes() {
    return this.prisma.certificate_types.findMany({ orderBy: { name: 'asc' } });
  }

  async create(dto: CreateCertificateRequestDto) {
    const student = await this.prisma.students.findUnique({ where: { id: dto.student_id } });
    if (!student) throw new NotFoundException({ message: 'Student not found.', errorCode: 'STUDENT_NOT_FOUND' });

    const certificateType = await this.prisma.certificate_types.findUnique({ where: { id: dto.certificate_type_id } });
    if (!certificateType) throw new NotFoundException({ message: 'Certificate type not found.', errorCode: 'CERTIFICATE_TYPE_NOT_FOUND' });

    const created = await this.prisma.certificate_requests.create({
      data: { student_id: dto.student_id, certificate_type_id: dto.certificate_type_id, fee_amount: dto.fee_amount },
      include: INCLUDE,
    });
    return withNumericFee(created);
  }

  async updateStatus(id: number, dto: UpdateCertificateStatusDto) {
    const existing = await this.prisma.certificate_requests.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ message: 'Certificate request not found.', errorCode: 'CERTIFICATE_REQUEST_NOT_FOUND' });

    const updated = await this.prisma.certificate_requests.update({
      where: { id },
      data: { status: dto.status, issued_at: dto.status === 'issued' ? new Date() : existing.issued_at },
      include: INCLUDE,
    });
    return withNumericFee(updated);
  }

  async updateFee(id: number, dto: UpdateCertificateFeeDto) {
    const existing = await this.prisma.certificate_requests.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ message: 'Certificate request not found.', errorCode: 'CERTIFICATE_REQUEST_NOT_FOUND' });

    const updated = await this.prisma.certificate_requests.update({
      where: { id },
      data: { fee_paid: dto.fee_paid },
      include: INCLUDE,
    });
    return withNumericFee(updated);
  }
}
