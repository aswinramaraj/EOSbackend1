import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateIncubationDto } from './dto/create-incubation.dto';
import { UpdateIncubationDto } from './dto/update-incubation.dto';
import { CreateMilestoneDto, UpdateMilestoneDto } from './dto/milestone.dto';

interface StudentSummarySource {
  id: number;
  student_id_no: string;
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
  classes: { section: string; departments: { code: string; name: string } } | null;
}

function resolveStudentDisplayName(student: StudentSummarySource): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

const INCUBATION_INCLUDE = {
  student_entrepreneurship: {
    include: {
      students: {
        select: {
          id: true,
          student_id_no: true,
          soa_applications: { select: { first_name: true, last_name: true } },
          users: { select: { email: true } },
          classes: { select: { section: true, departments: { select: { code: true, name: true } } } },
        },
      },
    },
  },
  faculty: { select: { id: true, first_name: true, last_name: true } },
  incubation_milestones: { orderBy: { sort_order: 'asc' as const } },
} as const;

/**
 * EDC Coordinator's "Incubation" screen — real `incubations` +
 * `incubation_milestones` tables (added this session; no such backend
 * concept existed before — the design's INCUBATION_FILE was pure sample
 * data). One incubation row per venture (student_entrepreneurship_id is
 * @unique), with a to-many milestones list.
 */
@Injectable()
export class IncubationsService {
  private readonly logger = new Logger(IncubationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toResponse(row: any) {
    const venture = row.student_entrepreneurship;
    const student = venture?.students;
    return {
      id: row.id,
      student_entrepreneurship_id: row.student_entrepreneurship_id,
      intake_label: row.intake_label,
      seat: row.seat,
      incubated_since: row.incubated_since,
      mentor_faculty_id: row.mentor_faculty_id,
      mentor_faculty_name: row.faculty ? `${row.faculty.first_name} ${row.faculty.last_name}` : null,
      review_attendance_note: row.review_attendance_note,
      last_review_note: row.last_review_note,
      next_review_date: row.next_review_date,
      grant_note: row.grant_note,
      services_note: row.services_note,
      status: row.status,
      progress_percent: row.progress_percent,
      created_at: row.created_at,
      business_name: venture?.business_name ?? null,
      business_category: venture?.business_category ?? null,
      student: student
        ? {
            id: student.id,
            student_id_no: student.student_id_no,
            name: resolveStudentDisplayName(student),
            section: student.classes?.section ?? null,
            department: student.classes?.departments ?? null,
          }
        : null,
      milestones: (row.incubation_milestones ?? []).map((m: any) => ({
        id: m.id,
        label: m.label,
        due_date: m.due_date,
        status: m.status,
        progress_percent: m.progress_percent,
        sort_order: m.sort_order,
      })),
    };
  }

  /** GET /me/incubations (EDC Coordinator only) — every incubated venture, real time. */
  async findAll() {
    try {
      const rows = await this.prisma.incubations.findMany({
        include: INCUBATION_INCLUDE,
        orderBy: { created_at: 'desc' },
      });
      return rows.map((row) => this.toResponse(row));
    } catch (err) {
      this.logger.error('DB error listing incubations', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    const row = await this.prisma.incubations.findUnique({ where: { id }, include: INCUBATION_INCLUDE });
    if (!row) {
      throw new NotFoundException({ message: 'Incubation record not found', errorCode: 'INCUBATION_NOT_FOUND' });
    }
    return this.toResponse(row);
  }

  /** POST /me/incubations — admits a venture into the incubation centre. */
  async create(dto: CreateIncubationDto, createdByUserId: number) {
    const venture = await this.prisma.student_entrepreneurship.findUnique({
      where: { id: dto.student_entrepreneurship_id },
    });
    if (!venture) {
      throw new NotFoundException({ message: 'Venture not found', errorCode: 'VENTURE_NOT_FOUND' });
    }
    const existing = await this.prisma.incubations.findUnique({
      where: { student_entrepreneurship_id: dto.student_entrepreneurship_id },
    });
    if (existing) {
      throw new ConflictException({
        message: 'This venture is already in the incubation centre.',
        errorCode: 'INCUBATION_ALREADY_EXISTS',
      });
    }

    try {
      const created = await this.prisma.incubations.create({
        data: {
          student_entrepreneurship_id: dto.student_entrepreneurship_id,
          intake_label: dto.intake_label,
          seat: dto.seat,
          incubated_since: dto.incubated_since ? new Date(dto.incubated_since) : undefined,
          mentor_faculty_id: dto.mentor_faculty_id,
          review_attendance_note: dto.review_attendance_note,
          last_review_note: dto.last_review_note,
          next_review_date: dto.next_review_date ? new Date(dto.next_review_date) : undefined,
          grant_note: dto.grant_note,
          services_note: dto.services_note,
          created_by_user_id: createdByUserId,
        },
        include: INCUBATION_INCLUDE,
      });
      // Keep the venture's own is_incubated flag in sync — this table is the
      // detailed record, that boolean is the summary flag other screens (EDC
      // Students/Startups) already read.
      await this.prisma.student_entrepreneurship.update({
        where: { id: dto.student_entrepreneurship_id },
        data: { is_incubated: true },
      });
      return this.toResponse(created);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'This venture is already in the incubation centre.',
          errorCode: 'INCUBATION_ALREADY_EXISTS',
        });
      }
      this.logger.error('DB error creating incubation', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** PATCH /me/incubations/:id — periodic review updates. */
  async update(id: number, dto: UpdateIncubationDto) {
    const existing = await this.prisma.incubations.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Incubation record not found', errorCode: 'INCUBATION_NOT_FOUND' });
    }

    try {
      const updated = await this.prisma.incubations.update({
        where: { id },
        data: {
          intake_label: dto.intake_label,
          seat: dto.seat,
          mentor_faculty_id: dto.mentor_faculty_id,
          review_attendance_note: dto.review_attendance_note,
          last_review_note: dto.last_review_note,
          next_review_date: dto.next_review_date ? new Date(dto.next_review_date) : undefined,
          grant_note: dto.grant_note,
          services_note: dto.services_note,
          status: dto.status,
          progress_percent: dto.progress_percent,
        },
        include: INCUBATION_INCLUDE,
      });

      if (dto.status === 'Graduated' || dto.status === 'Exited') {
        await this.prisma.student_entrepreneurship.update({
          where: { id: existing.student_entrepreneurship_id },
          data: { is_incubated: false },
        });
      }

      return this.toResponse(updated);
    } catch (err) {
      this.logger.error('DB error updating incubation', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** DELETE /me/incubations/:id — removes the venture from the incubation
   * centre (e.g. added by mistake) without deleting the venture itself.
   * Milestones cascade automatically (incubation_milestones.incubation_id
   * is onDelete: Cascade). Also clears the venture's is_incubated flag. */
  async remove(id: number) {
    const existing = await this.prisma.incubations.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Incubation record not found', errorCode: 'INCUBATION_NOT_FOUND' });
    }
    try {
      await this.prisma.incubations.delete({ where: { id } });
      await this.prisma.student_entrepreneurship.update({
        where: { id: existing.student_entrepreneurship_id },
        data: { is_incubated: false },
      });
      return { id, deleted: true };
    } catch (err) {
      this.logger.error('DB error deleting incubation', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** POST /me/incubations/:id/milestones */
  async addMilestone(incubationId: number, dto: CreateMilestoneDto) {
    const incubation = await this.prisma.incubations.findUnique({ where: { id: incubationId } });
    if (!incubation) {
      throw new NotFoundException({ message: 'Incubation record not found', errorCode: 'INCUBATION_NOT_FOUND' });
    }
    try {
      await this.prisma.incubation_milestones.create({
        data: {
          incubation_id: incubationId,
          label: dto.label,
          due_date: dto.due_date ? new Date(dto.due_date) : undefined,
          status: dto.status,
          progress_percent: dto.progress_percent,
          sort_order: dto.sort_order,
        },
      });
      return this.findOne(incubationId);
    } catch (err) {
      this.logger.error('DB error creating incubation_milestone', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** PATCH /me/incubations/milestones/:id */
  async updateMilestone(milestoneId: number, dto: UpdateMilestoneDto) {
    const existing = await this.prisma.incubation_milestones.findUnique({ where: { id: milestoneId } });
    if (!existing) {
      throw new NotFoundException({ message: 'Milestone not found', errorCode: 'MILESTONE_NOT_FOUND' });
    }
    try {
      await this.prisma.incubation_milestones.update({
        where: { id: milestoneId },
        data: {
          label: dto.label,
          due_date: dto.due_date ? new Date(dto.due_date) : undefined,
          status: dto.status,
          progress_percent: dto.progress_percent,
          sort_order: dto.sort_order,
        },
      });
      return this.findOne(existing.incubation_id);
    } catch (err) {
      this.logger.error('DB error updating incubation_milestone', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
