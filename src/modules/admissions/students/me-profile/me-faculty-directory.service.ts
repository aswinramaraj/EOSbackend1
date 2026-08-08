import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class MeFacultyDirectoryService {
  private readonly logger = new Logger(MeFacultyDirectoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/faculty-directory
   *
   * A minimal, student-safe faculty picker - name + department only, no
   * email/phone/designation/date_of_joining (unlike GET /faculty, which is
   * Admin/HoD-only and returns the full HR record). Institution-wide, not
   * scoped to the caller's own department - a student presenting outside
   * their department may still want a guide from elsewhere. Unpaginated:
   * the whole faculty roster is ~70 rows, small enough for a single
   * dropdown fetch.
   *
   * Error cases:
   *  500 INTERNAL_ERROR - unexpected DB failure
   */
  async getFacultyDirectory() {
    const faculty = await this.fetchActiveFaculty();

    return faculty.map((f) => ({
      id: f.id,
      name: `${f.first_name} ${f.last_name ?? ''}`.trim(),
      department_name: f.departments.name,
    }));
  }

  private async fetchActiveFaculty() {
    try {
      return await this.prisma.faculty.findMany({
        where: { status: 'active' },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          departments: { select: { name: true } },
        },
        orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
      });
    } catch (err) {
      this.logger.error('Failed to fetch faculty directory', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
