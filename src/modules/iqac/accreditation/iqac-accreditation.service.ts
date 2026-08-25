import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateAccreditationItemDto } from './dto/create-accreditation-item.dto';

export type AccreditationCycle = 'naac' | 'aqar' | 'ssr';

/**
 * NAAC/AQAR/SSR progress — real iqac_accreditation_criteria/
 * iqac_accreditation_evidence_items rows, all owned by IQAC (unlike NBA,
 * which stays Secretary-owned/read-only for IQAC — see
 * IqacAccreditationController's own doc comment).
 */
@Injectable()
export class IqacAccreditationService {
  constructor(private readonly prisma: PrismaService) {}

  async items(cycle: AccreditationCycle, departmentId?: number) {
    const rows = await this.prisma.iqac_accreditation_criteria.findMany({
      where: {
        cycle,
        ...(departmentId != null ? { department_id: departmentId } : {}),
      },
      orderBy: { sort_order: 'asc' },
      include: {
        faculty: { select: { id: true, first_name: true, last_name: true } },
        departments: { select: { id: true, code: true, name: true } },
        iqac_accreditation_evidence_items: { select: { id: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      criterion_number: r.sort_order,
      name: r.name,
      owner: r.faculty
        ? { id: r.faculty.id, name: `${r.faculty.first_name} ${r.faculty.last_name}` }
        : null,
      department: r.departments,
      due_date: r.due_date,
      readiness_percent: r.readiness_percent,
      status: r.status,
      note: r.note,
      evidence_count: r.iqac_accreditation_evidence_items.length,
    }));
  }

  /** Real mean of readiness_percent for one cycle, institution-wide — used by the Reports scorecard. */
  async meanReadiness(cycle: AccreditationCycle): Promise<number | null> {
    const rows = await this.prisma.iqac_accreditation_criteria.findMany({
      where: { cycle },
      select: { readiness_percent: true },
    });
    if (rows.length === 0) return null;
    return Math.round(
      rows.reduce((sum, r) => sum + r.readiness_percent, 0) / rows.length,
    );
  }

  /**
   * POST /me/iqac/accreditation/{naac,aqar,ssr}
   * code is derived server-side as "{CYCLE}-C{criterion_number}" — matches
   * an existing real item by (cycle, code) or creates one.
   */
  async createItem(cycle: AccreditationCycle, dto: CreateAccreditationItemDto) {
    const code = `${cycle.toUpperCase()}-C${dto.criterion_number}`;
    return this.prisma.iqac_accreditation_criteria.upsert({
      where: { cycle_code: { cycle, code } },
      create: {
        cycle,
        code,
        name: dto.name,
        owner_faculty_id: dto.owner_faculty_id,
        sort_order: dto.criterion_number,
        department_id: dto.department_id,
        due_date: dto.due_date ? new Date(dto.due_date) : undefined,
        readiness_percent: dto.readiness_percent,
        status: dto.status,
        note: dto.note,
      },
      update: {
        name: dto.name,
        owner_faculty_id: dto.owner_faculty_id,
        department_id: dto.department_id,
        due_date: dto.due_date ? new Date(dto.due_date) : undefined,
        readiness_percent: dto.readiness_percent,
        status: dto.status,
        note: dto.note,
      },
    });
  }
}
