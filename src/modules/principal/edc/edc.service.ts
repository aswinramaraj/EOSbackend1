import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListEdcQueryDto } from './dto/list-edc-query.dto';

@Injectable()
export class PrincipalEdcService {
  constructor(private readonly prisma: PrismaService) {}

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
   * as having progressed.
   *
   * "Incubated" now comes from the real `incubations` 1:1 relation (a
   * dedicated table with its own real `status` field, default 'Active')
   * rather than the plain `is_incubated` boolean — the relation is the
   * richer, more specific source of truth. "Active" = incubations where
   * status is literally 'Active' (freeform text column, so other real
   * values could appear later; never assumed to be the only one).
   */
  async summary() {
    const rows = await this.prisma.student_entrepreneurship.findMany({
      select: {
        id: true,
        stage: true,
        registration_type: true,
        incubations: { select: { status: true } },
      },
    });
    const beyondIdea = rows.filter((r) => {
      const stage = r.stage?.trim().toLowerCase();
      return !!stage && stage !== 'idea';
    }).length;

    const registeredVenturesCount = rows.filter(
      (r) =>
        r.registration_type != null && r.registration_type !== 'unregistered',
    ).length;
    const incubatedCount = rows.filter((r) => r.incubations != null).length;
    const activeCount = rows.filter(
      (r) => r.incubations?.status === 'Active',
    ).length;

    return {
      students_in_edc: rows.length,
      startups_beyond_idea: beyondIdea,
      registered_ventures_count: registeredVenturesCount,
      incubated_count: incubatedCount,
      active_count: activeCount,
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
    const rows = await this.prisma.student_entrepreneurship.findMany({
      select: {
        id: true,
        business_name: true,
        business_description: true,
        sector: true,
        stage: true,
        funding_required: true,
        remarks: true,
        registration_type: true,
        is_incubated: true,
        role: true,
        incubations: { select: { status: true } },
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
    });

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

        return {
          id: row.id,
          student: { id: student.id, name, register_no: student.register_no },
          batch: student.batches,
          department,
          venture: row.business_name,
          description: row.business_description,
          domain: row.sector,
          stage: row.stage,
          registration_type: row.registration_type,
          is_incubated: row.is_incubated,
          incubation_status: row.incubations?.status ?? null,
          role: row.role,
          funding_required:
            row.funding_required != null ? Number(row.funding_required) : null,
          remarks: row.remarks,
        };
      })
      .filter((r) => {
        if (query.batch_id && r.batch?.id !== query.batch_id) return false;
        if (query.department_id && r.department?.id !== query.department_id)
          return false;
        if (query.status && r.incubation_status !== query.status) return false;
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
