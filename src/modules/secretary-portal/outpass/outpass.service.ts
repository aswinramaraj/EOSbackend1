import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { paginate } from 'src/common/dto/pagination.dto';
import { CreateOutpassDto } from './dto/create-outpass.dto';
import { ListOutpassQueryDto } from './dto/list-outpass-query.dto';

interface OutpassRow {
  id: number;
  student_id: number;
  kind: string;
  outpass_date: Date;
  from_time: Date;
  to_time: Date;
  reason: string;
  parent_contact: string | null;
  status: string;
  approved_at: Date | null;
  created_at: Date;
  student_name: string | null;
  student_email: string;
  student_id_no: string;
  section: string | null;
  mentor_name: string | null;
}

function toResponse(row: OutpassRow) {
  return {
    id: row.id,
    student: { id: row.student_id, name: row.student_name ?? row.student_email, student_id_no: row.student_id_no, section: row.section },
    mentor_name: row.mentor_name,
    kind: row.kind,
    outpass_date: row.outpass_date,
    from_time: row.from_time,
    to_time: row.to_time,
    reason: row.reason,
    parent_contact: row.parent_contact,
    status: row.status,
    approved_at: row.approved_at,
    created_at: row.created_at,
  };
}

/**
 * Student Outpass — Secretary Portal "Student Outpass" screen. Same-day
 * gate-pass workflow, its own table (deliberately not repurposing
 * student_leaves/hostel_outings — see the migration's own comment).
 * Institution-wide for Secretary/Admin/Principal.
 */
@Injectable()
export class OutpassService {
  private readonly logger = new Logger(OutpassService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toTimeOnly(value: string): Date {
    return new Date(`1970-01-01T${value}:00.000Z`);
  }
  private toDateOnly(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  async create(dto: CreateOutpassDto, userId: number) {
    const student = await this.prisma.students.findUnique({ where: { id: dto.student_id } });
    if (!student) {
      throw new NotFoundException({ message: 'Student not found', errorCode: 'STUDENT_NOT_FOUND' });
    }

    try {
      await this.prisma.student_outpasses.create({
        data: {
          student_id: dto.student_id,
          kind: dto.kind,
          outpass_date: this.toDateOnly(dto.outpass_date),
          from_time: this.toTimeOnly(dto.from_time),
          to_time: this.toTimeOnly(dto.to_time),
          reason: dto.reason,
          parent_contact: dto.parent_contact,
          status: 'pending',
          created_by_user_id: userId,
        },
      });
    } catch (err) {
      this.logger.error('DB error creating outpass', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }

    const [row] = await this.queryRows(Prisma.sql`WHERE so.student_id = ${dto.student_id} ORDER BY so.id DESC LIMIT 1`);
    return toResponse(row);
  }

  private queryRows(whereClause: Prisma.Sql) {
    return this.prisma.$queryRaw<OutpassRow[]>(Prisma.sql`
      SELECT so.id, so.student_id, so.kind, so.outpass_date, so.from_time, so.to_time,
        so.reason, so.parent_contact, so.status, so.approved_at, so.created_at,
        soa.first_name || COALESCE(' ' || soa.last_name, '') AS student_name,
        u.email AS student_email, st.student_id_no, cl.section AS section,
        (fac.first_name || ' ' || fac.last_name) AS mentor_name
      FROM student_outpasses so
      JOIN students st ON st.id = so.student_id
      JOIN users u ON u.id = st.user_id
      LEFT JOIN soa_applications soa ON soa.id = st.soa_application_id
      LEFT JOIN classes cl ON cl.id = st.class_id
      LEFT JOIN class_mentors cm ON cm.class_id = cl.id
      LEFT JOIN faculty fac ON fac.id = cm.faculty_id
      ${whereClause}
    `);
  }

  async findAll(query: ListOutpassQueryDto) {
    const filters: Prisma.Sql[] = [];
    if (query.status) filters.push(Prisma.sql`so.status = ${query.status}`);
    const whereClause = filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;
    const limit = query.limit ?? 20;
    const offset = query.skip;

    const [rows, countRows] = await Promise.all([
      this.queryRows(Prisma.sql`${whereClause} ORDER BY so.created_at DESC LIMIT ${limit} OFFSET ${offset}`),
      this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM student_outpasses so ${whereClause}`),
    ]);

    return paginate(rows.map(toResponse), Number(countRows[0]?.count ?? 0), query);
  }

  async updateStatus(id: number, status: 'approved' | 'rejected', userId: number) {
    const existing = await this.prisma.student_outpasses.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Outpass not found', errorCode: 'OUTPASS_NOT_FOUND' });
    }
    await this.prisma.student_outpasses.update({
      where: { id },
      data: { status, approved_by_user_id: userId, approved_at: new Date() },
    });
    const [row] = await this.queryRows(Prisma.sql`WHERE so.id = ${id}`);
    return toResponse(row);
  }
}
