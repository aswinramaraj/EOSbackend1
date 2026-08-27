import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';

/** Accreditation/NBA — Secretary Portal "Accreditation Documentation"
 * screen. Institution-wide for Admin/Principal; a Secretary is locked to her
 * own department (resolved from her non_teaching_staff row, same pattern
 * HOD uses via faculty.department_id) — any department_id she supplies is
 * ignored in favour of her own. */
@Injectable()
export class AccreditationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Secretary is always forced to her own department; other roles keep whatever was requested (or none = institution-wide). */
  private async resolveEffectiveDepartmentId(
    user: JwtPayload,
    requested?: number,
  ): Promise<number | undefined> {
    if (user.role !== ROLES.SECRETARY) return requested;
    const staff = await this.prisma.non_teaching_staff.findFirst({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!staff?.department_id) {
      throw new ForbiddenException({
        message: 'No department is assigned to this secretary account',
        errorCode: 'SECRETARY_NO_DEPARTMENT',
      });
    }
    return staff.department_id;
  }

  async getOverview(user: JwtPayload, departmentId?: number) {
    const effectiveDepartmentId = await this.resolveEffectiveDepartmentId(user, departmentId);
    return this.getOverviewForDepartment(effectiveDepartmentId);
  }

  private async getOverviewForDepartment(departmentId?: number) {
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
    user: JwtPayload,
    departmentId: number,
    code: string,
    name: string,
    maxMarks: number,
  ) {
    // departmentId is required on this call (unlike getOverview's optional
    // filter), so the result is never actually undefined here — it's either
    // the caller-supplied value (non-Secretary) or the Secretary's own
    // resolved department (resolveEffectiveDepartmentId throws otherwise).
    const effectiveDepartmentId = await this.resolveEffectiveDepartmentId(user, departmentId);
    return this.prisma.nba_criteria.create({
      data: { department_id: effectiveDepartmentId!, code, name, max_marks: maxMarks },
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
