import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListEdcQueryDto } from './dto/list-edc-query.dto';

interface VentureExtrasRow {
  id: number;
  registration_type: string | null;
  is_incubated: boolean | null;
  role: string | null;
}

@Injectable()
export class PrincipalEdcService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `registration_type`/`is_incubated`/`role` are real (query.md #5 ran) —
   * still read via `$queryRaw` rather than the typed client (predates the
   * `prisma db pull` that synced these columns into schema.prisma); fine
   * to convert to typed calls whenever this file is next touched.
   */
  private async tryLoadVentureExtras(): Promise<Map<number, VentureExtrasRow>> {
    try {
      const rows = await this.prisma.$queryRaw<VentureExtrasRow[]>`
        SELECT id, registration_type, is_incubated, role FROM student_entrepreneurship
      `;
      return new Map(rows.map((r) => [r.id, r]));
    } catch {
      return new Map();
    }
  }

  /** GET /me/principal/edc/filters — real batches/departments only. */
  async filters() {
    const [batches, departments] = await Promise.all([
      this.prisma.batches.findMany({
        select: { id: true, name: true },
        orderBy: { start_year: 'desc' },
      }),
      this.prisma.departments.findMany({
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { batches, departments };
  }

  /**
   * GET /me/principal/edc/summary
   *
   * "Startups" (beyond idea stage) is a judgment call over the real
   * free-text `stage` column: a null/empty stage or literally "idea"
   * (case-insensitive) counts as idea-stage, anything else on file counts
   * as having progressed — there's no "still active" signal to layer on
   * top (no status/closed flag exists), so that part of the reference
   * design's wording is dropped.
   *
   * "Registered ventures" / "Startups inside college" are real once
   * query.md #5 is run — until then both are null/untracked, not invented.
   */
  async summary() {
    const [rows, ventureExtras] = await Promise.all([
      this.prisma.student_entrepreneurship.findMany({
        select: { id: true, stage: true },
      }),
      this.tryLoadVentureExtras(),
    ]);
    const beyondIdea = rows.filter((r) => {
      const stage = r.stage?.trim().toLowerCase();
      return !!stage && stage !== 'idea';
    }).length;

    const extrasTracked = ventureExtras.size > 0;
    const extraRows = rows
      .map((r) => ventureExtras.get(r.id))
      .filter((r): r is VentureExtrasRow => r != null);
    const registeredVenturesCount = extraRows.filter(
      (r) =>
        r.registration_type != null && r.registration_type !== 'unregistered',
    ).length;
    const incubatedCount = extraRows.filter(
      (r) => r.is_incubated === true,
    ).length;

    return {
      students_in_edc: rows.length,
      startups_beyond_idea: beyondIdea,
      registered_ventures_count: extrasTracked ? registeredVenturesCount : null,
      incubated_count: extrasTracked ? incubatedCount : null,
    };
  }

  /**
   * GET /me/principal/edc
   *
   * Only 1 real row exists today — fetches everything matching the filters,
   * no server pagination, same tradeoff as Students/Faculty/Higher
   * Education. `registration_type`/`is_incubated`/`role` are real once
   * query.md #5 is run — until then all null.
   */
  async list(query: ListEdcQueryDto) {
    const [rows, ventureExtras] = await Promise.all([
      this.prisma.student_entrepreneurship.findMany({
        select: {
          id: true,
          business_name: true,
          business_description: true,
          sector: true,
          stage: true,
          funding_required: true,
          remarks: true,
          students: {
            select: {
              id: true,
              register_no: true,
              batches: { select: { id: true, name: true } },
              classes: {
                select: {
                  departments: { select: { id: true, name: true, code: true } },
                },
              },
              courses: {
                select: {
                  departments: { select: { id: true, name: true, code: true } },
                },
              },
              users: { select: { email: true } },
              soa_applications: {
                select: { first_name: true, last_name: true },
              },
            },
          },
        },
        orderBy: { id: 'desc' },
      }),
      this.tryLoadVentureExtras(),
    ]);

    const records = rows
      .map((row) => {
        const student = row.students;
        const department =
          student.classes?.departments ?? student.courses?.departments ?? null;
        const name =
          student.soa_applications?.first_name ||
          student.soa_applications?.last_name
            ? [
                student.soa_applications?.first_name,
                student.soa_applications?.last_name,
              ]
                .filter(Boolean)
                .join(' ')
            : student.users.email;
        const extras = ventureExtras.get(row.id);

        return {
          id: row.id,
          student: { id: student.id, name, register_no: student.register_no },
          batch: student.batches,
          department,
          venture: row.business_name,
          description: row.business_description,
          domain: row.sector,
          stage: row.stage,
          registration_type: extras?.registration_type ?? null,
          is_incubated: extras?.is_incubated ?? null,
          role: extras?.role ?? null,
          funding_required:
            row.funding_required != null ? Number(row.funding_required) : null,
          remarks: row.remarks,
        };
      })
      .filter((r) => {
        if (query.batch_id && r.batch?.id !== query.batch_id) return false;
        if (query.department_id && r.department?.id !== query.department_id)
          return false;
        if (query.q) {
          const q = query.q.toLowerCase();
          const haystack = [
            r.student.name,
            r.student.register_no,
            r.venture,
            r.domain,
            r.stage,
            r.department?.name,
            r.department?.code,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });

    return { total: records.length, records };
  }
}
