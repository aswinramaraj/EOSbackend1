import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class IqacDepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/iqac/departments/naac-readiness
   *
   * Real mean of iqac_accreditation_criteria.readiness_percent for
   * cycle='naac' — a genuine readiness proxy, not a NAAC-certified score
   * (no external assessor score exists anywhere in this schema; this is
   * IQAC's own self-reported checklist progress). institution_mean covers
   * every real naac item on file (department-scoped or institution-wide);
   * by_department only covers items with a real department_id — an
   * institution-wide item has no single department to attribute to.
   */
  async naacReadiness() {
    const rows = await this.prisma.iqac_accreditation_criteria.findMany({
      where: { cycle: 'naac' },
      select: { department_id: true, readiness_percent: true },
    });

    const institutionMean =
      rows.length > 0
        ? Math.round(
            rows.reduce((sum, r) => sum + r.readiness_percent, 0) /
              rows.length,
          )
        : null;

    const byDept = new Map<number, { sum: number; count: number }>();
    for (const r of rows) {
      if (r.department_id == null) continue;
      const entry = byDept.get(r.department_id) ?? { sum: 0, count: 0 };
      entry.sum += r.readiness_percent;
      entry.count += 1;
      byDept.set(r.department_id, entry);
    }

    return {
      institution_mean_readiness: institutionMean,
      item_count: rows.length,
      by_department: [...byDept.entries()].map(([departmentId, e]) => ({
        department_id: departmentId,
        mean_readiness: Math.round(e.sum / e.count),
      })),
    };
  }
}
