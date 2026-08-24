import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/** Accreditation/NBA — Secretary Portal "Accreditation Documentation"
 * screen. Institution-wide for Secretary/Admin/Principal. */
@Injectable()
export class AccreditationService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(departmentId?: number) {
    const criteria = await this.prisma.nba_criteria.findMany({
      where:
        departmentId !== undefined
          ? { department_id: departmentId }
          : undefined,
      orderBy: { sort_order: 'asc' },
      include: {
        nba_evidence_items: true,
        departments: { select: { id: true, name: true, code: true } },
      },
    });

    const criteriaOut = criteria.map((c) => {
      const done = c.nba_evidence_items.filter((i) => i.done).length;
      const status =
        done === c.nba_evidence_items.length && c.nba_evidence_items.length > 0
          ? 'complete'
          : done === 0
            ? 'missing'
            : 'in_progress';
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        max_marks: c.max_marks,
        department: c.departments,
        done_count: done,
        total_count: c.nba_evidence_items.length,
        status,
        items: c.nba_evidence_items.map((i) => ({
          id: i.id,
          label: i.label,
          done: i.done,
        })),
      };
    });

    const allItems = criteria.flatMap((c) => c.nba_evidence_items);
    const doneCount = allItems.filter((i) => i.done).length;
    const readinessPct =
      allItems.length > 0 ? Math.round((doneCount / allItems.length) * 100) : 0;

    return {
      readiness_pct: readinessPct,
      done_count: doneCount,
      total_count: allItems.length,
      criteria: criteriaOut,
    };
  }

  async createCriterion(
    departmentId: number,
    code: string,
    name: string,
    maxMarks: number,
  ) {
    return this.prisma.nba_criteria.create({
      data: { department_id: departmentId, code, name, max_marks: maxMarks },
    });
  }

  async addEvidenceItem(criterionId: number, label: string) {
    const criterion = await this.prisma.nba_criteria.findUnique({
      where: { id: criterionId },
    });
    if (!criterion) {
      throw new NotFoundException({
        message: 'Criterion not found',
        errorCode: 'CRITERION_NOT_FOUND',
      });
    }
    return this.prisma.nba_evidence_items.create({
      data: { criterion_id: criterionId, label },
    });
  }

  async toggleEvidenceItem(itemId: number, userId: number) {
    const item = await this.prisma.nba_evidence_items.findUnique({
      where: { id: itemId },
    });
    if (!item) {
      throw new NotFoundException({
        message: 'Evidence item not found',
        errorCode: 'EVIDENCE_ITEM_NOT_FOUND',
      });
    }
    await this.prisma.nba_evidence_items.update({
      where: { id: itemId },
      data: {
        done: !item.done,
        updated_by_user_id: userId,
        updated_at: new Date(),
      },
    });
    return { id: itemId, done: !item.done };
  }
}
