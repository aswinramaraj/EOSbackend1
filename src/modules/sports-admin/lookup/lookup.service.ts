import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { buildMultiWordNameWhere } from 'src/common/utils/name-search.util';
import {
  INTERNAL_ERROR,
  resolveFacultyName,
  resolveStudentName,
  studentAcademicMeta,
  STUDENT_DISPLAY_INCLUDE,
} from '../common/sports-common';

const LOOKUP_LIMIT = 10;

/**
 * "Find the real person" endpoints backing every student/faculty picker in
 * the sports-admin forms — the whole point is that nobody should ever have
 * to type an internal `students.id`/`faculty.id` by hand. Students are
 * matched on roll number, register number, admission number or name;
 * faculty (who have no roll-number equivalent) on name or email.
 */
@Injectable()
export class SportsLookupService {
  private readonly logger = new Logger(SportsLookupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/lookup/students?q= */
  async searchStudents(q: string) {
    const term = q.trim();
    if (term.length < 2) return [];

    // Each word must independently match first/last name (order-
    // independent — "Malar Sekar" and "Sekar Malar" both match
    // first_name="Malar", last_name="Sekar"); id/roll/register/admission
    // are single tokens, matched against the whole raw term.
    const nameWhere = buildMultiWordNameWhere(term, (word) => [
      { first_name: { contains: word, mode: 'insensitive' as const } },
      { last_name: { contains: word, mode: 'insensitive' as const } },
    ]);

    try {
      const students = await this.prisma.students.findMany({
        where: {
          OR: [
            { roll_no: { contains: term, mode: 'insensitive' } },
            { register_no: { contains: term, mode: 'insensitive' } },
            { student_id_no: { contains: term, mode: 'insensitive' } },
            { admission_no: { contains: term, mode: 'insensitive' } },
            ...(nameWhere ? [{ soa_applications: nameWhere }] : []),
          ],
        },
        include: STUDENT_DISPLAY_INCLUDE,
        take: LOOKUP_LIMIT,
        orderBy: { id: 'asc' },
      });

      return students.map((s) => ({
        id: s.id,
        name: resolveStudentName(s),
        roll_no: s.roll_no,
        register_no: s.register_no,
        meta: studentAcademicMeta(s),
      }));
    } catch (err) {
      this.logger.error('DB error while looking up students', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** GET /sports-admin/lookup/faculty?q= */
  async searchFaculty(q: string) {
    const term = q.trim();
    if (term.length < 2) return [];

    // Each word must independently match first/last name (order-
    // independent — "Malar Sekar" and "Sekar Malar" both match
    // first_name="Malar", last_name="Sekar"); email is a single token,
    // matched against the whole raw term.
    const facultyNameWhere = buildMultiWordNameWhere(term, (word) => [
      { first_name: { contains: word, mode: 'insensitive' as const } },
      { last_name: { contains: word, mode: 'insensitive' as const } },
    ]);

    try {
      const faculty = await this.prisma.faculty.findMany({
        where: {
          OR: [
            ...(facultyNameWhere ? [facultyNameWhere] : []),
            { users: { email: { contains: term, mode: 'insensitive' } } },
          ],
        },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          designation: true,
          departments: { select: { name: true } },
          users: { select: { email: true } },
        },
        take: LOOKUP_LIMIT,
        orderBy: { id: 'asc' },
      });

      return faculty.map((f) => ({
        id: f.id,
        name: resolveFacultyName(f),
        designation: f.designation,
        meta: [f.departments?.name, f.users?.email].filter(Boolean).join(' · '),
      }));
    } catch (err) {
      this.logger.error('DB error while looking up faculty', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
