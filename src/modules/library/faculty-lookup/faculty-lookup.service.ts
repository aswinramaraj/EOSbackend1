import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class FacultyLookupService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /library/faculty/search — the Issue Books desk's faculty borrower
   * search. Mirrors FinanceTrackingService.searchFaculty's plain
   * contains-match pattern (not the students endpoint's pg_trgm fuzzy
   * scoring) — a small, exact staff directory doesn't need typo-tolerant
   * ranking, and a precise match keeps this endpoint from ever surfacing an
   * unrelated name the way the fuzzy student search could.
   */
  async search(q?: string) {
    const term = (q ?? '').trim();
    // Each word must match somewhere (first name, last name, staff code or
    // email) independently — a single OR across the whole term would fail
    // "Gokul Ravi" outright, since first_name alone ("Gokul") does not
    // contain the two-word string being searched for.
    const words = term.split(/\s+/).filter(Boolean);

    const rows = await this.prisma.faculty.findMany({
      where: {
        status: 'active',
        ...(words.length > 0
          ? {
              AND: words.map((word) => ({
                OR: [
                  {
                    first_name: {
                      contains: word,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    last_name: { contains: word, mode: 'insensitive' as const },
                  },
                  {
                    staff_code: {
                      contains: word,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    users: {
                      email: { contains: word, mode: 'insensitive' as const },
                    },
                  },
                ],
              })),
            }
          : {}),
      },
      orderBy: [{ first_name: 'asc' }],
      take: 20,
      select: {
        id: true,
        first_name: true,
        last_name: true,
        designation: true,
        staff_code: true,
        departments: { select: { name: true, code: true } },
        users: { select: { email: true } },
      },
    });

    return rows.map((f) => ({
      id: f.id,
      name: `${f.first_name} ${f.last_name}`.trim(),
      designation: f.designation,
      staff_code: f.staff_code,
      email: f.users.email,
      department: f.departments
        ? { name: f.departments.name, code: f.departments.code }
        : null,
    }));
  }
}
