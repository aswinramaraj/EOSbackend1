import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListHigherEducationQueryDto } from './dto/list-higher-education-query.dto';

interface ScholarshipRow {
  id: number;
  is_scholarship: boolean | null;
  scholarship_name: string | null;
  admission_status: string | null;
}

@Injectable()
export class PrincipalHigherEducationService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /me/principal/higher-education/filters — real batches/departments only. */
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
   * `is_scholarship`/`scholarship_name`/`admission_status` are real
   * (query.md #4 ran) — still read via `$queryRaw` rather than the typed
   * client (predates the `prisma db pull` that synced these columns into
   * schema.prisma); fine to convert to typed calls whenever this file is
   * next touched.
   */
  private async tryLoadScholarshipData(): Promise<Map<number, ScholarshipRow>> {
    try {
      const rows = await this.prisma.$queryRaw<ScholarshipRow[]>`
        SELECT id, is_scholarship, scholarship_name, admission_status FROM student_higher_education
      `;
      return new Map(rows.map((r) => [r.id, r]));
    } catch {
      return new Map();
    }
  }

  /**
   * GET /me/principal/higher-education/summary
   *
   * "Overseas" is derived as `preferred_country` not case-insensitively
   * equal to "India" (no is_abroad flag exists). Scholarship count and
   * confirmed-admission count are real once query.md #4 is run — until
   * then both are 0/untracked, not invented.
   */
  async summary() {
    const [rows, scholarshipData] = await Promise.all([
      this.prisma.student_higher_education.findMany({
        select: { id: true, preferred_country: true },
      }),
      this.tryLoadScholarshipData(),
    ]);
    const overseas = rows.filter(
      (r) => r.preferred_country.trim().toLowerCase() !== 'india',
    ).length;
    const countries = new Set(
      rows
        .filter((r) => r.preferred_country.trim().toLowerCase() !== 'india')
        .map((r) => r.preferred_country.trim()),
    );

    const scholarshipRows = rows
      .map((r) => scholarshipData.get(r.id))
      .filter((r): r is ScholarshipRow => r != null);
    const scholarshipTracked = scholarshipData.size > 0;
    const scholarshipCount = scholarshipRows.filter(
      (r) => r.is_scholarship === true,
    ).length;
    const confirmedAdmissionCount = scholarshipRows.filter(
      (r) =>
        r.admission_status === 'admitted' || r.admission_status === 'enrolled',
    ).length;

    return {
      total: rows.length,
      within_india: rows.length - overseas,
      overseas,
      countries_count: countries.size,
      countries: Array.from(countries).sort(),
      scholarship_count: scholarshipTracked ? scholarshipCount : null,
      confirmed_admission_count: scholarshipTracked
        ? confirmedAdmissionCount
        : null,
    };
  }

  /**
   * GET /me/principal/higher-education
   *
   * Only 2 real rows exist today — fetches everything matching the filters,
   * no server pagination, same tradeoff as Students/Faculty.
   */
  async list(query: ListHigherEducationQueryDto) {
    const [rows, scholarshipData] = await Promise.all([
      this.prisma.student_higher_education.findMany({
        select: {
          id: true,
          preferred_course: true,
          preferred_country: true,
          preferred_university: true,
          remarks: true,
          students: {
            select: {
              id: true,
              register_no: true,
              batch_id: true,
              batches: { select: { id: true, name: true } },
              classes: {
                select: {
                  department_id: true,
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
      this.tryLoadScholarshipData(),
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
        const scholarship = scholarshipData.get(row.id);

        return {
          id: row.id,
          student: { id: student.id, name, register_no: student.register_no },
          batch: student.batches,
          department,
          programme: row.preferred_course,
          university: row.preferred_university,
          country: row.preferred_country,
          is_abroad: row.preferred_country.trim().toLowerCase() !== 'india',
          remarks: row.remarks,
          is_scholarship: scholarship?.is_scholarship ?? null,
          scholarship_name: scholarship?.scholarship_name ?? null,
          admission_status: scholarship?.admission_status ?? null,
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
            r.programme,
            r.university,
            r.country,
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
