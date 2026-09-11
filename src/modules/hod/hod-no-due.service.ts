import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import type { ListNoDueStudentsQueryDto } from '../faculty/no-due/dto/list-no-due-students-query.dto';
import { NoDueService } from '../faculty/no-due/no-due.service';
import { SubjectNoDueService } from '../faculty/subject-no-due/subject-no-due.service';

function yearLabel(semester: number | null): string {
  if (semester == null) return '—';
  return ['I', 'II', 'III', 'IV'][Math.ceil(semester / 2) - 1] ?? '—';
}

/**
 * GET /hod/no-due and /hod/no-due/classes — a class-scoped adaptation of
 * the real, already-built department-wide `NoDueService` (live fee/library
 * dues, no stored "cleared" column anywhere). Every field here traces back
 * to that real computation.
 *
 * Known, documented simplification: the frontend's fixed category-boolean
 * model (library/laboratory/fees/hostel/academics) doesn't match the real
 * service's dynamic, data-driven fee-category list (whatever
 * `demand_categories` rows actually exist — not a fixed set). `library_cleared`
 * maps directly (the real service has a dedicated library computation).
 * `fees_cleared` is true only if every real fee category for that student
 * is cleared. `laboratory_cleared`/`hostel_cleared` look for a real fee
 * category whose name contains that word; if no such category exists for a
 * student, there is nothing owed in it, so it's honestly reported as
 * cleared (not fabricated true — genuinely no due). `academics_cleared`
 * comes from SubjectNoDueService — true only if every subject-handling
 * faculty for the student's currently-taken subjects has manually signed
 * off (see subject_academic_clearance / no_due.query.md #1); an unassigned
 * subject can never be cleared there, unlike the fee-keyword categories.
 * The PATCH action only supports `issue` (the real "approve override"
 * action) — none of the category booleans have a real per-category
 * override in the schema, so a patch touching only those fields is a
 * no-op; only `issue` calls the real backend.
 */
@Injectable()
export class HodNoDueService {
  private readonly logger = new Logger(HodNoDueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly noDue: NoDueService,
    private readonly subjectNoDue: SubjectNoDueService,
  ) {}

  private async resolveDepartment(user: JwtPayload) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    const department = await this.prisma.departments.findUnique({
      where: { id: faculty.department_id },
      select: { id: true, name: true, code: true },
    });
    if (!department) {
      throw new NotFoundException({
        message: 'Department not found.',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }
    return department;
  }

  async getClasses(user: JwtPayload) {
    const department = await this.resolveDepartment(user);
    const classes = await this.prisma.classes.findMany({
      where: { department_id: department.id },
      select: { id: true, section: true, current_semester: true },
      orderBy: [{ current_semester: 'asc' }, { section: 'asc' }],
    });
    return classes.map((c) => ({
      class_id: c.id,
      section: c.section,
      semester: c.current_semester ?? 0,
      year_label: yearLabel(c.current_semester),
    }));
  }

  private categoryCleared(
    fees: { category: string; cleared: boolean }[],
    keyword: string,
  ): boolean {
    const match = fees.filter((f) =>
      f.category.toLowerCase().includes(keyword),
    );
    if (match.length === 0) return true; // no such fee applies to this student — nothing owed
    return match.every((f) => f.cleared);
  }

  async getList(user: JwtPayload, classId: number, search: string | undefined) {
    const department = await this.resolveDepartment(user);
    const cls = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: { id: true, section: true, department_id: true },
    });
    if (!cls || cls.department_id !== department.id) {
      throw new NotFoundException({
        message: 'Class not found in your department.',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    // Sequential — same pooler-capacity discipline as every other hod
    // service; the real service filters by status server-side, so both
    // buckets need their own call to get a full picture.
    const pending = await this.noDue.getStudentsForClass(
      classId,
      {
        limit: 100,
        page: 1,
        skip: 0,
        search,
        status: 'pending',
      } as unknown as ListNoDueStudentsQueryDto,
      user.sub,
    );
    const cleared = await this.noDue.getStudentsForClass(
      classId,
      {
        limit: 100,
        page: 1,
        skip: 0,
        search,
        status: 'cleared',
      } as unknown as ListNoDueStudentsQueryDto,
      user.sub,
    );
    const all = [...pending.data, ...cleared.data];

    const academicsByStudent = await this.subjectNoDue.getAcademicsClearedMap(
      classId,
      all.map((s) => s.id),
    );

    const rows = all.map((s) => ({
      student_id: s.id,
      student_id_no: s.student_id_no,
      name: s.name,
      class_label: cls.section,
      library_cleared: s.library.cleared,
      laboratory_cleared: this.categoryCleared(s.fees, 'lab'),
      fees_cleared: s.fees.every((f) => f.cleared),
      hostel_cleared: this.categoryCleared(s.fees, 'hostel'),
      academics_cleared: academicsByStudent.get(s.id) ?? false,
      issued: s.override_approved,
    }));

    // `pending` mirrors the row-level "Overall" badge (issued vs not), not
    // the real dues-outstanding bucket used to build `rows` above — those
    // are independent axes (a student can have an approved override while
    // still owing real fees), so using the latter here would make the
    // summary badges fail to add up to `in_scope`.
    const issuedCount = rows.filter((r) => r.issued).length;
    return {
      department,
      class: { id: cls.id, label: cls.section },
      counts: {
        in_scope: rows.length,
        issued: issuedCount,
        pending: rows.length - issuedCount,
      },
      rows,
    };
  }

  async patch(user: JwtPayload, studentId: number, body: { issue?: boolean }) {
    if (body.issue) {
      return this.noDue.approveOverride(studentId, user.sub);
    }
    // No real per-category override exists for the other boolean fields —
    // clearance is derived from live dues, not independently settable.
    return { student_id: studentId, updated: false };
  }
}
