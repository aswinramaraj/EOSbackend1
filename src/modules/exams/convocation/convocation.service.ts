import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListConvocationQueryDto } from './dto/list-convocation-query.dto';

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
} as const;

@Injectable()
export class ConvocationService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListConvocationQueryDto) {
    const where: Prisma.convocation_registrationsWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.students = {
        OR: [
          { student_id_no: { contains: query.search, mode: 'insensitive' } },
          { register_no: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    const rows = await this.prisma.convocation_registrations.findMany({
      where,
      include: INCLUDE,
      orderBy: { id: 'desc' },
    });
    return rows.map((r) => ({ ...r, cgpa: r.cgpa != null ? Number(r.cgpa) : null }));
  }

  async getStats() {
    const [eligible, shortfall, registered, degreeAwarded] = await Promise.all([
      this.prisma.convocation_registrations.count({ where: { status: 'eligible' } }),
      this.prisma.convocation_registrations.count({ where: { status: 'shortfall' } }),
      this.prisma.convocation_registrations.count({ where: { status: 'registered' } }),
      this.prisma.convocation_registrations.count({ where: { status: 'degree_awarded' } }),
    ]);

    return { eligible, shortfall, registered, degree_awarded: degreeAwarded };
  }

  async register(id: number) {
    const existing = await this.prisma.convocation_registrations.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ message: 'Convocation record not found.', errorCode: 'CONVOCATION_NOT_FOUND' });
    if (existing.status !== 'eligible') {
      throw new BadRequestException({ message: 'Only eligible students can be registered for convocation.', errorCode: 'NOT_ELIGIBLE' });
    }

    const updated = await this.prisma.convocation_registrations.update({
      where: { id },
      data: { status: 'registered', registered_at: new Date() },
      include: INCLUDE,
    });
    return { ...updated, cgpa: updated.cgpa != null ? Number(updated.cgpa) : null };
  }

  async awardDegree(id: number) {
    const existing = await this.prisma.convocation_registrations.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ message: 'Convocation record not found.', errorCode: 'CONVOCATION_NOT_FOUND' });
    if (existing.status !== 'registered') {
      throw new BadRequestException({ message: 'Only registered students can be marked as degree awarded.', errorCode: 'NOT_REGISTERED' });
    }

    const updated = await this.prisma.convocation_registrations.update({
      where: { id },
      data: { status: 'degree_awarded' },
      include: INCLUDE,
    });
    return { ...updated, cgpa: updated.cgpa != null ? Number(updated.cgpa) : null };
  }
}
