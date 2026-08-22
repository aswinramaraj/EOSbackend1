import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateStartupIdeaDto } from './dto/create-startup-idea.dto';
import { UpdateStartupIdeaDto } from './dto/update-startup-idea.dto';

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

function toStudentSummary(student: StudentSummarySource) {
  return {
    id: student.id,
    student_id_no: student.student_id_no,
    name: resolveStudentDisplayName(student),
    section: student.classes?.section ?? null,
    department: student.classes?.departments ?? null,
  };
}

const IDEA_INCLUDE = {
  students: {
    select: {
      id: true,
      student_id_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      users: { select: { email: true } },
      classes: { select: { section: true, departments: { select: { code: true, name: true } } } },
    },
  },
  faculty: { select: { first_name: true, last_name: true } },
  users: { select: { email: true } },
  student_entrepreneurship: { select: { id: true, business_name: true } },
} as const;

/**
 * EDC Coordinator's "Startup Ideas" screen — a real, dedicated table
 * (`startup_ideas`, added for this module; genuinely didn't exist before —
 * the only prior backend concept was a single `idea_developed` boolean on
 * student_entrepreneurship). Institution-wide, no department/class scoping
 * (mirrors student-entrepreneurship's coordinator route).
 */
@Injectable()
export class StartupIdeasService {
  private readonly logger = new Logger(StartupIdeasService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toResponse(row: any) {
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      problem_statement: row.problem_statement,
      solution: row.solution,
      target_customers: row.target_customers,
      market_size: row.market_size,
      competitors: row.competitors,
      team_note: row.team_note,
      budget_needed: row.budget_needed !== null ? Number(row.budget_needed) : null,
      feasibility_score: row.feasibility_score,
      feasibility_confidence: row.feasibility_confidence,
      attachments_note: row.attachments_note,
      mentor_faculty_id: row.mentor_faculty_id,
      mentor_faculty_name: row.faculty ? `${row.faculty.first_name} ${row.faculty.last_name}` : null,
      review_status: row.review_status,
      reviewer_user_id: row.reviewer_user_id,
      reviewer_email: row.users?.email ?? null,
      reviewer_note: row.reviewer_note,
      conversion_note: row.conversion_note,
      converted_venture_id: row.converted_venture_id,
      converted_venture_name: row.student_entrepreneurship?.business_name ?? null,
      target_milestone: row.target_milestone,
      submitted_at: row.submitted_at,
      student: toStudentSummary(row.students),
    };
  }

  /** GET /me/startup-ideas (EDC Coordinator only) — every idea, real time. */
  async findAll() {
    try {
      const rows = await this.prisma.startup_ideas.findMany({
        include: IDEA_INCLUDE,
        orderBy: { submitted_at: 'desc' },
      });
      return rows.map((row) => this.toResponse(row));
    } catch (err) {
      this.logger.error('DB error listing startup_ideas', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /me/startup-ideas/:id */
  async findOne(id: number) {
    const row = await this.prisma.startup_ideas.findUnique({
      where: { id },
      include: IDEA_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException({
        message: 'Startup idea not found',
        errorCode: 'STARTUP_IDEA_NOT_FOUND',
      });
    }
    return this.toResponse(row);
  }

  /** POST /me/startup-ideas (EDC Coordinator only) — logs a submitted idea on a student's behalf. */
  async create(dto: CreateStartupIdeaDto) {
    const student = await this.prisma.students.findUnique({ where: { id: dto.student_id } });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    try {
      const created = await this.prisma.startup_ideas.create({
        data: {
          student_id: dto.student_id,
          title: dto.title,
          category: dto.category,
          problem_statement: dto.problem_statement,
          solution: dto.solution,
          target_customers: dto.target_customers,
          market_size: dto.market_size,
          competitors: dto.competitors,
          team_note: dto.team_note,
          budget_needed: dto.budget_needed,
          feasibility_score: dto.feasibility_score,
          feasibility_confidence: dto.feasibility_confidence,
          attachments_note: dto.attachments_note,
          mentor_faculty_id: dto.mentor_faculty_id,
          target_milestone: dto.target_milestone,
        },
        include: IDEA_INCLUDE,
      });
      return this.toResponse(created);
    } catch (err) {
      this.logger.error('DB error creating startup_idea', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** PATCH /me/startup-ideas/:id (EDC Coordinator only) — review/decision. */
  async update(id: number, dto: UpdateStartupIdeaDto, reviewerUserId: number) {
    const existing = await this.prisma.startup_ideas.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Startup idea not found',
        errorCode: 'STARTUP_IDEA_NOT_FOUND',
      });
    }

    try {
      const updated = await this.prisma.startup_ideas.update({
        where: { id },
        data: {
          review_status: dto.review_status,
          reviewer_note: dto.reviewer_note,
          conversion_note: dto.conversion_note,
          converted_venture_id: dto.converted_venture_id,
          mentor_faculty_id: dto.mentor_faculty_id,
          target_milestone: dto.target_milestone,
          ...(dto.review_status ? { reviewer_user_id: reviewerUserId } : {}),
        },
        include: IDEA_INCLUDE,
      });
      return this.toResponse(updated);
    } catch (err) {
      this.logger.error('DB error updating startup_idea', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** DELETE /me/startup-ideas/:id (EDC Coordinator only). */
  async remove(id: number) {
    const existing = await this.prisma.startup_ideas.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Startup idea not found',
        errorCode: 'STARTUP_IDEA_NOT_FOUND',
      });
    }
    await this.prisma.startup_ideas.delete({ where: { id } });
    return { id, deleted: true };
  }
}
