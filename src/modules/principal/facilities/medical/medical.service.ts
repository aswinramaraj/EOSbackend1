import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

/** Same June academic-year cutoff convention used across every other Principal page this session. */
function currentAcademicYearStart(today: Date): Date {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const startYear = month >= 6 ? year : year - 1;
  return new Date(Date.UTC(startYear, 5, 1));
}

export interface EquipmentRow {
  id: number;
  name: string;
  quantity: number;
  location: string | null;
  condition: string;
}

@Injectable()
export class PrincipalMedicalService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /me/principal/facilities/medical/summary */
  async summary() {
    const today = startOfToday();
    const yearStart = currentAcademicYearStart(today);
    const monthStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );

    const [studentsTreatedThisYear, visitsThisMonth, staff, equipment] =
      await Promise.all([
        this.prisma.medical_visits.count({
          where: { visitor_type: 'student', visit_date: { gte: yearStart } },
        }),
        this.prisma.medical_visits.count({
          where: { visit_date: { gte: monthStart } },
        }),
        this.prisma.medical_staff.findMany({ select: { designation: true } }),
        this.tryLoadEquipment(),
      ]);

    const designationCounts = new Map<string, number>();
    for (const s of staff) {
      const key = s.designation ?? 'Other';
      designationCounts.set(key, (designationCounts.get(key) ?? 0) + 1);
    }

    return {
      students_treated_this_year: studentsTreatedThisYear,
      visits_this_month: visitsThisMonth,
      staff_count: staff.length,
      staff_by_designation: Array.from(designationCounts.entries()).map(
        ([designation, count]) => ({ designation, count }),
      ),
      equipment_types: equipment.length,
      equipment_total_quantity: equipment.reduce(
        (sum, e) => sum + e.quantity,
        0,
      ),
    };
  }

  /** GET /me/principal/facilities/medical/team */
  async team() {
    const staff = await this.prisma.medical_staff.findMany({
      select: {
        id: true,
        name: true,
        designation: true,
        shift_time: true,
        phone: true,
      },
      orderBy: { name: 'asc' },
    });
    return staff;
  }

  /** GET /me/principal/facilities/medical/treatment-log */
  async treatmentLog() {
    const fourDaysAgo = new Date(startOfToday());
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 3);

    const visits = await this.prisma.medical_visits.findMany({
      where: { visit_date: { gte: fourDaysAgo } },
      orderBy: { visit_date: 'desc' },
      select: {
        id: true,
        visitor_type: true,
        visit_date: true,
        reason: true,
        diagnosis: true,
        treatment_given: true,
        medical_staff: { select: { name: true } },
        students: {
          select: {
            classes: {
              select: {
                current_semester: true,
                departments: { select: { code: true } },
              },
            },
            courses: { select: { departments: { select: { code: true } } } },
            users: { select: { email: true } },
            soa_applications: { select: { first_name: true, last_name: true } },
          },
        },
        faculty: { select: { first_name: true, last_name: true } },
      },
    });

    return visits.map((v) => {
      let personName: string;
      let context: string | null = null;
      if (v.visitor_type === 'student' && v.students) {
        const s = v.students;
        personName =
          s.soa_applications?.first_name || s.soa_applications?.last_name
            ? [s.soa_applications?.first_name, s.soa_applications?.last_name]
                .filter(Boolean)
                .join(' ')
            : s.users.email;
        const dept =
          s.classes?.departments?.code ?? s.courses?.departments?.code ?? null;
        const sem = s.classes?.current_semester ?? null;
        context =
          [dept, sem != null ? `Sem ${sem}` : null]
            .filter(Boolean)
            .join(' · ') || null;
      } else if (v.faculty) {
        personName = `${v.faculty.first_name} ${v.faculty.last_name}`;
        context = 'Faculty';
      } else {
        personName = 'Unknown';
      }

      return {
        id: v.id,
        person_name: personName,
        context,
        visit_date: v.visit_date.toISOString().slice(0, 10),
        reason: v.reason,
        diagnosis: v.diagnosis,
        treatment_given: v.treatment_given,
        attended_by: v.medical_staff?.name ?? null,
      };
    });
  }

  /**
   * GET /me/principal/facilities/medical/equipment
   *
   * `medical_equipment` (query.md #10) — no equipment register existed for
   * the medical centre before this. Still read via `$queryRaw` rather than
   * the typed client (predates the `prisma db pull` that synced this table
   * into schema.prisma); fine to convert whenever this file is next touched.
   */
  async equipment() {
    return this.tryLoadEquipment();
  }

  private async tryLoadEquipment(): Promise<EquipmentRow[]> {
    try {
      return await this.prisma.$queryRaw<EquipmentRow[]>`
        SELECT id, name, quantity, location, condition FROM medical_equipment ORDER BY name ASC
      `;
    } catch {
      return [];
    }
  }
}
