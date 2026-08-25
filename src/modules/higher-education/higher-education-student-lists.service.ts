import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { requireUpdateSet } from './higher-education-sql.util';
import type {
  AddApplicationStudentDto,
  AddTestStudentDto,
  UpdateApplicationStudentDto,
  UpdateTestStudentDto,
} from './dto/application-students.dto';

/**
 * Student-level lists behind an application window and behind a test.
 *
 * Backed by higher_education_application_students and
 * higher_education_test_students (see
 * prisma/migrations/higher_education_student_lists.sql). Both are reached
 * through raw SQL rather than Prisma models: the schema deliberately has not
 * been re-introspected, so the generated client does not know these tables.
 *
 * Name, roll number, register number and department are always read from
 * `students` and its class -> department chain rather than copied into these
 * tables, so a corrected admission record shows through everywhere at once.
 */

/** Shared student projection so both lists describe a student identically. */
const STUDENT_COLUMNS = Prisma.sql`
  s.id                                                        AS student_id,
  s.roll_no,
  s.register_no,
  s.student_id_no,
  TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))) AS name,
  u.email,
  d.name                                                      AS department_name,
  d.code                                                      AS department_code,
  b.name                                                      AS batch_name
`;

const STUDENT_JOINS = Prisma.sql`
  JOIN students s              ON s.id = x.student_id
  LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
  LEFT JOIN users u            ON u.id = s.user_id
  LEFT JOIN classes c          ON c.id = s.class_id
  LEFT JOIN departments d      ON d.id = c.department_id
  LEFT JOIN batches b          ON b.id = c.batch_id
`;

interface StudentRow {
  student_id: number;
  roll_no: string | null;
  register_no: string | null;
  student_id_no: string | null;
  name: string | null;
  email: string | null;
  department_name: string | null;
  department_code: string | null;
  batch_name: string | null;
}

interface ApplicationStudentRow extends StudentRow {
  id: number;
  status: string;
  applied_on: Date | null;
  decided_on: Date | null;
  remarks: string | null;
}

interface TestStudentRow extends StudentRow {
  id: number;
  enrolled_on: Date | null;
  attempted_on: Date | null;
  cleared_on: Date | null;
  score: string | null;
  remarks: string | null;
}

function dateOnly(v: Date | null): string | null {
  return v ? v.toISOString().slice(0, 10) : null;
}

/** A blank name falls back to the email so a row is never unidentifiable. */
function displayName(r: StudentRow): string {
  const n = (r.name ?? '').trim();
  return n.length > 0 ? n : (r.email ?? 'Unknown student');
}

function baseStudent(r: StudentRow) {
  return {
    student_id: r.student_id,
    name: displayName(r),
    roll_no: r.roll_no,
    register_no: r.register_no,
    student_id_no: r.student_id_no,
    department_name: r.department_name,
    department_code: r.department_code,
    batch_name: r.batch_name,
  };
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return (
    e?.code === 'P2002' ||
    /duplicate key|unique constraint/i.test(String(e?.message ?? ''))
  );
}

function isCheckViolation(err: unknown): boolean {
  return /violates check constraint/i.test(
    String((err as { message?: string })?.message ?? ''),
  );
}

@Injectable()
export class HigherEducationStudentListsService {
  private readonly logger = new Logger(HigherEducationStudentListsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────── student picker ─────────────────────────────

  /**
   * GET /me/higher-education-student-search?q=
   *
   * Case-insensitive across name, roll number, register number and student id,
   * so the coordinator can type whichever identifier they have. A two-word
   * query is also matched as first name + last name.
   */
  async searchStudents(q: string) {
    const like = `%${q}%`;
    const parts = q.split(/\s+/).filter(Boolean);
    const firstLast =
      parts.length === 2
        ? Prisma.sql`
            OR (sa.first_name ILIKE ${`%${parts[0]}%`}
                AND sa.last_name ILIKE ${`%${parts[1]}%`})`
        : Prisma.empty;

    try {
      const rows = await this.prisma.$queryRaw<StudentRow[]>(Prisma.sql`
        SELECT s.id AS student_id, s.roll_no, s.register_no, s.student_id_no,
               TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))) AS name,
               u.email, d.name AS department_name, d.code AS department_code,
               b.name AS batch_name
        FROM students s
        LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
        LEFT JOIN users u             ON u.id = s.user_id
        LEFT JOIN classes c           ON c.id = s.class_id
        LEFT JOIN departments d       ON d.id = c.department_id
        LEFT JOIN batches b           ON b.id = c.batch_id
        WHERE s.roll_no ILIKE ${like}
           OR s.register_no ILIKE ${like}
           OR s.student_id_no ILIKE ${like}
           OR sa.first_name ILIKE ${like}
           OR sa.last_name ILIKE ${like}
           ${firstLast}
        ORDER BY sa.first_name NULLS LAST, s.id
        LIMIT 25
      `);
      return rows.map((r) => baseStudent(r));
    } catch (err) {
      this.logger.error('DB error searching students', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** Turns either identifier in the DTO into a student id. */
  private async resolveStudentId(dto: {
    student_id?: number;
    register_no?: string;
  }): Promise<number> {
    if (dto.student_id != null) {
      const exists = await this.prisma.students.count({
        where: { id: dto.student_id },
      });
      if (exists === 0) {
        throw new NotFoundException({
          message: 'Student not found',
          errorCode: 'STUDENT_NOT_FOUND',
        });
      }
      return dto.student_id;
    }

    if (!dto.register_no) {
      throw new BadRequestException({
        message: 'Provide either student_id or register_no',
        errorCode: 'VALIDATION_ERROR',
      });
    }

    // Case-insensitive: register numbers get typed in every casing.
    const found = await this.prisma.students.findFirst({
      where: { register_no: { equals: dto.register_no, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException({
        message: `No student found with register number ${dto.register_no}`,
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    return found.id;
  }

  // ─────────────────────── application window students ───────────────────────

  private async assertWindowExists(windowId: number): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
      SELECT id FROM higher_education_application_windows WHERE id = ${windowId}
    `);
    if (rows.length === 0) {
      throw new NotFoundException({
        message: 'Application window not found',
        errorCode: 'APPLICATION_WINDOW_NOT_FOUND',
      });
    }
  }

  /** GET /me/higher-education-application-windows/:id/students */
  async listApplicationStudents(windowId: number) {
    await this.assertWindowExists(windowId);

    try {
      const rows = await this.prisma.$queryRaw<ApplicationStudentRow[]>(Prisma.sql`
        SELECT x.id, x.status, x.applied_on, x.decided_on, x.remarks,
               ${STUDENT_COLUMNS}
        FROM higher_education_application_students x
        ${STUDENT_JOINS}
        WHERE x.window_id = ${windowId}
        ORDER BY x.status, sa.first_name NULLS LAST, x.id
      `);

      const students = rows.map((r) => ({
        id: r.id,
        ...baseStudent(r),
        status: r.status,
        applied_on: dateOnly(r.applied_on),
        decided_on: dateOnly(r.decided_on),
        remarks: r.remarks,
      }));

      return {
        window_id: windowId,
        // Counts computed from the rows themselves, so the tab header cannot
        // disagree with the list underneath it.
        total: students.length,
        applied: students.filter((s) => s.status === 'applied').length,
        selected: students.filter((s) => s.status === 'selected').length,
        rejected: students.filter((s) => s.status === 'rejected').length,
        withdrawn: students.filter((s) => s.status === 'withdrawn').length,
        students,
      };
    } catch (err) {
      this.logger.error('DB error listing application students', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** POST /me/higher-education-application-windows/:id/students */
  async addApplicationStudent(
    windowId: number,
    dto: AddApplicationStudentDto,
    userId: number,
  ) {
    await this.assertWindowExists(windowId);
    const studentId = await this.resolveStudentId(dto);

    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO higher_education_application_students
          (window_id, student_id, status, applied_on, remarks, created_by_user_id)
        VALUES (
          ${windowId},
          ${studentId},
          ${dto.status ?? 'applied'},
          ${dto.applied_on ? new Date(`${dto.applied_on}T00:00:00.000Z`) : null},
          ${dto.remarks ?? null},
          ${userId}
        )
        RETURNING id
      `);
      this.logger.log(
        `Application student added: window=${windowId} student=${studentId}`,
      );
      return { id: rows[0].id, window_id: windowId, student_id: studentId };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          message: 'That student is already on this application',
          errorCode: 'APPLICATION_STUDENT_EXISTS',
        });
      }
      this.logger.error('DB error adding application student', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /me/higher-education-application-students/:id
   *
   * Moving a student to a decided status stamps `decided_on` when the caller
   * did not supply one, so "selected" always carries the date it happened.
   */
  async updateApplicationStudent(
    id: number,
    dto: UpdateApplicationStudentDto,
  ) {
    const decided =
      dto.status === 'selected' ||
      dto.status === 'rejected' ||
      dto.status === 'withdrawn';

    const decidedOn =
      dto.decided_on !== undefined
        ? new Date(`${dto.decided_on}T00:00:00.000Z`)
        : decided
          ? new Date()
          : dto.status === 'applied'
            ? null // moved back to applied: the old decision date no longer holds
            : undefined;

    const set = requireUpdateSet([
      { column: 'status', value: dto.status },
      {
        column: 'applied_on',
        value: dto.applied_on
          ? new Date(`${dto.applied_on}T00:00:00.000Z`)
          : undefined,
      },
      { column: 'decided_on', value: decidedOn },
      { column: 'remarks', value: dto.remarks },
    ]);

    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        UPDATE higher_education_application_students
        SET ${set} WHERE id = ${id} RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({
          message: 'Application student row not found',
          errorCode: 'APPLICATION_STUDENT_NOT_FOUND',
        });
      }
      return { id };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      if (isCheckViolation(err)) {
        throw new BadRequestException({
          message: 'That status is not allowed',
          errorCode: 'VALIDATION_ERROR',
        });
      }
      this.logger.error('DB error updating application student', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** DELETE /me/higher-education-application-students/:id */
  async removeApplicationStudent(id: number) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        DELETE FROM higher_education_application_students WHERE id = ${id} RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({
          message: 'Application student row not found',
          errorCode: 'APPLICATION_STUDENT_NOT_FOUND',
        });
      }
      return { id, message: 'Student removed from this application' };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error removing application student', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  // ───────────────────────────── test students ─────────────────────────────

  private async assertTestExists(testName: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ test_name: string }[]>(Prisma.sql`
      SELECT test_name FROM higher_education_test_register WHERE test_name = ${testName}
    `);
    if (rows.length === 0) {
      throw new NotFoundException({
        message: 'Test not found',
        errorCode: 'TEST_NOT_FOUND',
      });
    }
  }

  /** GET /me/higher-education-test-register/:testName/students */
  async listTestStudents(testName: string) {
    await this.assertTestExists(testName);

    try {
      const rows = await this.prisma.$queryRaw<TestStudentRow[]>(Prisma.sql`
        SELECT x.id, x.enrolled_on, x.attempted_on, x.cleared_on, x.score, x.remarks,
               ${STUDENT_COLUMNS}
        FROM higher_education_test_students x
        ${STUDENT_JOINS}
        WHERE x.test_name = ${testName}
        ORDER BY sa.first_name NULLS LAST, x.id
      `);

      const students = rows.map((r) => ({
        id: r.id,
        ...baseStudent(r),
        enrolled_on: dateOnly(r.enrolled_on),
        attempted_on: dateOnly(r.attempted_on),
        cleared_on: dateOnly(r.cleared_on),
        score: r.score,
        remarks: r.remarks,
        // Derived, never stored: a cleared student is necessarily also an
        // attempted one, and deriving keeps those from ever disagreeing.
        enrolled: true,
        attempted: r.attempted_on !== null,
        cleared: r.cleared_on !== null,
      }));

      return {
        test_name: testName,
        total: students.length,
        enrolled: students.length,
        attempted: students.filter((s) => s.attempted).length,
        cleared: students.filter((s) => s.cleared).length,
        students,
      };
    } catch (err) {
      this.logger.error('DB error listing test students', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /me/higher-education-test-register/:testName/students
   *
   * `enrolled_on` is left NULL when not supplied rather than defaulted to
   * today. Defaulting it would make back-filling impossible: the table refuses
   * an attempt earlier than enrolment, so stamping today would block recording
   * a test the student sat last week. Membership of this table is what marks a
   * student enrolled; the date is when, if it is known.
   */
  async addTestStudent(
    testName: string,
    dto: AddTestStudentDto,
    userId: number,
  ) {
    await this.assertTestExists(testName);
    const studentId = await this.resolveStudentId(dto);

    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO higher_education_test_students
          (test_name, student_id, enrolled_on, created_by_user_id)
        VALUES (
          ${testName},
          ${studentId},
          ${dto.enrolled_on ? new Date(`${dto.enrolled_on}T00:00:00.000Z`) : null},
          ${userId}
        )
        RETURNING id
      `);
      this.logger.log(
        `Test student added: test=${testName} student=${studentId}`,
      );
      return { id: rows[0].id, test_name: testName, student_id: studentId };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          message: 'That student is already registered for this test',
          errorCode: 'TEST_STUDENT_EXISTS',
        });
      }
      this.logger.error('DB error adding test student', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** PATCH /me/higher-education-test-students/:id — advance a stage or record a score. */
  async updateTestStudent(id: number, dto: UpdateTestStudentDto) {
    const asDate = (v: string | undefined) =>
      v === undefined ? undefined : new Date(`${v}T00:00:00.000Z`);

    const set = requireUpdateSet([
      { column: 'enrolled_on', value: asDate(dto.enrolled_on) },
      { column: 'attempted_on', value: asDate(dto.attempted_on) },
      { column: 'cleared_on', value: asDate(dto.cleared_on) },
      { column: 'score', value: dto.score },
      { column: 'remarks', value: dto.remarks },
    ]);

    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        UPDATE higher_education_test_students
        SET ${set} WHERE id = ${id} RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({
          message: 'Test student row not found',
          errorCode: 'TEST_STUDENT_NOT_FOUND',
        });
      }
      return { id };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      // The table enforces stage order and "cleared implies attempted"; report
      // that as the caller's mistake rather than a server fault.
      if (isCheckViolation(err)) {
        throw new BadRequestException({
          message:
            'Those dates are out of order — a test cannot be cleared before it was attempted, or attempted before enrolment.',
          errorCode: 'TEST_STAGE_ORDER_INVALID',
        });
      }
      this.logger.error('DB error updating test student', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** DELETE /me/higher-education-test-students/:id */
  async removeTestStudent(id: number) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        DELETE FROM higher_education_test_students WHERE id = ${id} RETURNING id
      `);
      if (rows.length === 0) {
        throw new NotFoundException({
          message: 'Test student row not found',
          errorCode: 'TEST_STUDENT_NOT_FOUND',
        });
      }
      return { id, message: 'Student removed from this test' };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error removing test student', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
