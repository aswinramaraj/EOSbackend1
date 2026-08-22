import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';

/** Postgres "relation does not exist" — thrown when the tables proposed in academic_coordinator.query.md haven't been created yet. */
const UNDEFINED_TABLE = '42P01';

/**
 * Prisma wraps a failed $queryRaw/$executeRaw in a PrismaClientKnownRequestError
 * whose own `.code` is a generic wrapper code ('P2010', "raw query failed") and
 * `.meta` is empty — the real Postgres SQLSTATE only shows up embedded in the
 * message text, e.g. "Raw query failed. Code: `42P01`. Message: `relation
 * \"program_outcomes\" does not exist`". So detection has to check the message.
 */
function isMissingTableError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  const metaCode = (err as { meta?: { code?: string } }).meta?.code;
  const message = (err as { message?: string }).message ?? '';
  return (
    code === UNDEFINED_TABLE ||
    metaCode === UNDEFINED_TABLE ||
    message.includes(UNDEFINED_TABLE)
  );
}

interface ProgramOutcomeRow {
  id: number;
  code: string;
  description: string;
  display_order: number;
}
interface CourseOutcomeRow {
  id: number;
  code: string;
  description: string;
  display_order: number;
}
interface MappingRow {
  course_outcome_id: number;
  program_outcome_id: number;
  correlation_level: number;
}
interface SubjectPassRow {
  passed: bigint;
  total: bigint;
}

@Injectable()
export class AcademicCoordinatorCopoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/coordinator/copo/subjects/:subjectId/matrix
   *
   * The 3 tables this reads (program_outcomes, course_outcomes,
   * co_po_mapping) are proposed in academic_coordinator.query.md and not yet
   * created — every query here is wrapped so a missing-table error produces
   * an honest "not set up yet" response instead of a 500, exactly as that
   * file's "Status" note promises. Attainment is a proxy (the subject's real
   * exam pass-rate scaled onto the same 1-3 correlation scale), since COs
   * aren't linked to individual exam questions anywhere in the schema — a
   * true per-CO attainment figure isn't derivable without that link.
   */
  async getMatrix(subjectId: number) {
    const subject = await this.prisma.subjects.findUnique({
      where: { id: subjectId },
      select: { id: true, department_id: true, subject_code: true, name: true },
    });
    if (!subject) {
      throw new BadRequestException({
        message: 'Subject not found',
        errorCode: 'SUBJECT_NOT_FOUND',
      });
    }

    try {
      const [pos, cos, mappings] = await Promise.all([
        this.prisma.$queryRaw<ProgramOutcomeRow[]>(Prisma.sql`
          SELECT id, code, description, display_order FROM program_outcomes
          WHERE department_id = ${subject.department_id} ORDER BY display_order, code
        `),
        this.prisma.$queryRaw<CourseOutcomeRow[]>(Prisma.sql`
          SELECT id, code, description, display_order FROM course_outcomes
          WHERE subject_id = ${subjectId} ORDER BY display_order, code
        `),
        this.prisma.$queryRaw<MappingRow[]>(Prisma.sql`
          SELECT m.course_outcome_id, m.program_outcome_id, m.correlation_level
          FROM co_po_mapping m
          JOIN course_outcomes co ON co.id = m.course_outcome_id
          WHERE co.subject_id = ${subjectId}
        `),
      ]);

      const attainment = await this.attainmentProxy(subjectId);
      const mappingByPair = new Map(
        mappings.map((m) => [
          `${m.course_outcome_id}:${m.program_outcome_id}`,
          m.correlation_level,
        ]),
      );

      return {
        tables_ready: true,
        subject: {
          id: subject.id,
          code: subject.subject_code,
          name: subject.name,
        },
        program_outcomes: pos,
        course_outcomes: cos.map((co) => ({ ...co, attainment })),
        matrix: cos.map((co) => ({
          course_outcome_id: co.id,
          cells: pos.map((po) => ({
            program_outcome_id: po.id,
            correlation_level: mappingByPair.get(`${co.id}:${po.id}`) ?? null,
          })),
        })),
      };
    } catch (err) {
      if (isMissingTableError(err)) {
        return {
          tables_ready: false,
          subject: {
            id: subject.id,
            code: subject.subject_code,
            name: subject.name,
          },
          program_outcomes: [],
          course_outcomes: [],
          matrix: [],
        };
      }
      throw err;
    }
  }

  /** Real exam pass-rate for the subject, scaled onto the 1-3 correlation scale — see class docstring above. */
  private async attainmentProxy(subjectId: number): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<SubjectPassRow[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE gb.is_pass)::bigint AS passed,
        COUNT(*)::bigint AS total
      FROM exam_marks em
      JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
      JOIN exams e ON e.id = esm.exam_id
      LEFT JOIN LATERAL (
        SELECT is_pass FROM grade_bands gb2
        WHERE gb2.min_percentage <= (CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)
        ORDER BY gb2.min_percentage DESC LIMIT 1
      ) gb ON true
      WHERE e.status = 'results_published' AND esm.subject_id = ${subjectId}
    `);
    const row = rows[0];
    if (!row || Number(row.total) === 0) return null;
    const passPct = Number(row.passed) / Number(row.total);
    return Math.round((1 + passPct * 2) * 100) / 100;
  }

  async addProgramOutcome(
    departmentId: number,
    code: string,
    description: string,
  ) {
    try {
      const maxOrder = await this.prisma.$queryRaw<
        { next: number }[]
      >(Prisma.sql`
        SELECT COALESCE(MAX(display_order), 0) + 1 AS next FROM program_outcomes WHERE department_id = ${departmentId}
      `);
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO program_outcomes (department_id, code, description, display_order)
        VALUES (${departmentId}, ${code}, ${description}, ${maxOrder[0]?.next ?? 1})
      `);
      return { created: true };
    } catch (err) {
      if (isMissingTableError(err)) {
        throw new BadRequestException({
          message:
            'CO-PO Mapping is not set up yet — ask an admin to run the migration in academic_coordinator.query.md.',
          errorCode: 'COPO_TABLES_NOT_READY',
        });
      }
      throw err;
    }
  }

  async addCourseOutcome(subjectId: number, code: string, description: string) {
    try {
      const maxOrder = await this.prisma.$queryRaw<
        { next: number }[]
      >(Prisma.sql`
        SELECT COALESCE(MAX(display_order), 0) + 1 AS next FROM course_outcomes WHERE subject_id = ${subjectId}
      `);
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO course_outcomes (subject_id, code, description, display_order)
        VALUES (${subjectId}, ${code}, ${description}, ${maxOrder[0]?.next ?? 1})
      `);
      return { created: true };
    } catch (err) {
      if (isMissingTableError(err)) {
        throw new BadRequestException({
          message:
            'CO-PO Mapping is not set up yet — ask an admin to run the migration in academic_coordinator.query.md.',
          errorCode: 'COPO_TABLES_NOT_READY',
        });
      }
      throw err;
    }
  }

  async setMapping(
    courseOutcomeId: number,
    programOutcomeId: number,
    correlationLevel: number,
  ) {
    try {
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO co_po_mapping (course_outcome_id, program_outcome_id, correlation_level)
        VALUES (${courseOutcomeId}, ${programOutcomeId}, ${correlationLevel})
        ON CONFLICT (course_outcome_id, program_outcome_id)
        DO UPDATE SET correlation_level = ${correlationLevel}, updated_at = now()
      `);
      return { saved: true };
    } catch (err) {
      if (isMissingTableError(err)) {
        throw new BadRequestException({
          message:
            'CO-PO Mapping is not set up yet — ask an admin to run the migration in academic_coordinator.query.md.',
          errorCode: 'COPO_TABLES_NOT_READY',
        });
      }
      throw err;
    }
  }
}
