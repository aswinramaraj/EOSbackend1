import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListHigherEducationQueryDto } from './dto/list-higher-education-query.dto';

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
   * GET /me/principal/higher-education/summary
   *
   * "Overseas" is derived as `preferred_country` not case-insensitively
   * equal to "India" (no is_abroad flag exists). `is_scholarship`/
   * `admission_status` are real columns (synced into schema.prisma), read
   * via the typed client directly now — no fallback needed.
   */
  async summary() {
    const rows = await this.prisma.student_higher_education.findMany({
      select: {
        id: true,
        preferred_country: true,
        is_scholarship: true,
        admission_status: true,
      },
    });
    const overseas = rows.filter(
      (r) => r.preferred_country.trim().toLowerCase() !== 'india',
    ).length;
    const countries = new Set(
      rows
        .filter((r) => r.preferred_country.trim().toLowerCase() !== 'india')
        .map((r) => r.preferred_country.trim()),
    );

    const scholarshipCount = rows.filter(
      (r) => r.is_scholarship === true,
    ).length;
    const confirmedAdmissionCount = rows.filter(
      (r) =>
        r.admission_status === 'admitted' || r.admission_status === 'enrolled',
    ).length;

    return {
      total: rows.length,
      within_india: rows.length - overseas,
      overseas,
      countries_count: countries.size,
      countries: Array.from(countries).sort(),
      scholarship_count: scholarshipCount,
      confirmed_admission_count: confirmedAdmissionCount,
    };
  }

  /**
   * GET /me/principal/higher-education
   *
   * Only 2 real rows exist today — fetches everything matching the filters,
   * no server pagination, same tradeoff as Students/Faculty.
   */
  async list(query: ListHigherEducationQueryDto) {
    const rows = await this.prisma.student_higher_education.findMany({
      select: {
        id: true,
        preferred_course: true,
        preferred_country: true,
        preferred_university: true,
        remarks: true,
        is_scholarship: true,
        scholarship_name: true,
        admission_status: true,
        students: {
          select: {
            id: true,
            register_no: true,
            roll_no: true,
            batch_id: true,
            batches: { select: { id: true, name: true } },
            classes: {
              select: {
                section: true,
                current_semester: true,
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
        const semester = student.classes?.current_semester ?? null;

        return {
          id: row.id,
          student: {
            id: student.id,
            name,
            register_no: student.register_no,
            roll_no: student.roll_no,
          },
          batch: student.batches,
          department,
          section: student.classes?.section ?? null,
          year: semester != null ? Math.ceil(semester / 2) : null,
          programme: row.preferred_course,
          university: row.preferred_university,
          country: row.preferred_country,
          is_abroad: row.preferred_country.trim().toLowerCase() !== 'india',
          remarks: row.remarks,
          is_scholarship: row.is_scholarship,
          scholarship_name: row.scholarship_name,
          admission_status: row.admission_status,
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
            r.student.roll_no,
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
