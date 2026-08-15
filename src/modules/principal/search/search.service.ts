import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { PrincipalStudentsService } from '../students/students.service';
import { PrincipalFacultyService } from '../faculty/faculty.service';
import { PrincipalApprovalsService } from '../approvals/approvals.service';
import { AnnouncementsService } from 'src/modules/announcements/announcements/announcements.service';

const RESULTS_PER_CATEGORY = 5;

@Injectable()
export class PrincipalSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: PrincipalStudentsService,
    private readonly facultyService: PrincipalFacultyService,
    private readonly approvalsService: PrincipalApprovalsService,
    private readonly announcementsService: AnnouncementsService,
  ) {}

  /**
   * GET /me/principal/search?q=
   *
   * Reuses each module's own real `q` search predicate (students/faculty/
   * approvals) rather than duplicating the filtering logic — this is a
   * thin fan-out + top-5-per-category slice on top of those, not a
   * separate search index. Departments has no existing search method
   * (its `list()` takes no query), so that one's a fresh lightweight
   * query here. Announcements has no `q` filter at all — filtered
   * in-memory over the same rows the Announcements page itself would see.
   */
  async search(q: string, user: JwtPayload) {
    const [students, faculty, departments, approvals, announcements] =
      await Promise.all([
        this.searchStudents(q),
        this.searchFaculty(q),
        this.searchDepartments(q),
        this.searchApprovals(q),
        this.searchAnnouncements(q, user),
      ]);

    return { students, faculty, departments, approvals, announcements };
  }

  private async searchStudents(q: string) {
    const { students } = await this.studentsService.list({ q });
    return students.slice(0, RESULTS_PER_CATEGORY).map((r) => ({
      id: r.id,
      name: r.name,
      register_no: r.register_no,
      department_code: r.department?.code ?? null,
    }));
  }

  private async searchFaculty(q: string) {
    const { faculty } = await this.facultyService.list({ q });
    return faculty.slice(0, RESULTS_PER_CATEGORY).map((f) => ({
      id: f.id,
      name: f.name,
      designation: f.designation,
      department_code: f.department?.code ?? null,
    }));
  }

  private async searchDepartments(q: string) {
    const rows = await this.prisma.departments.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { code: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, code: true },
      take: RESULTS_PER_CATEGORY,
      orderBy: { name: 'asc' },
    });
    return rows;
  }

  private async searchApprovals(q: string) {
    const { items } = await this.approvalsService.list({ status: 'all', q });
    return items.slice(0, RESULTS_PER_CATEGORY).map((i) => ({
      kind: i.kind,
      id: i.id,
      faculty_name: i.faculty.name,
      summary: i.summary,
      status: i.principal_approval_status,
    }));
  }

  private async searchAnnouncements(q: string, user: JwtPayload) {
    const all = (await this.announcementsService.findAll(user)) as unknown as {
      id: number;
      title: string;
      content: string;
    }[];
    const needle = q.toLowerCase();
    return all
      .filter(
        (a) =>
          a.title.toLowerCase().includes(needle) ||
          a.content.toLowerCase().includes(needle),
      )
      .slice(0, RESULTS_PER_CATEGORY)
      .map((a) => ({ id: a.id, title: a.title }));
  }
}
