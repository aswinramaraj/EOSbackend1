import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { detectMedicalCentreSchema } from './medical-centre-schema.util';

export type DashboardRange = 'today' | 'week' | 'year';

interface VisitRow {
  id: number;
  visit_date: Date;
  reason: string | null;
  diagnosis: string | null;
  treatment_given: string | null;
  referred_to_hospital: boolean;
  student_name: string | null;
  faculty_name: string | null;
  staff_name: string | null;
}

interface OccupiedBedRow {
  bed_id: number;
  bed_code: string;
  reason: string | null;
  admitted_at: Date;
  student_name: string | null;
  faculty_name: string | null;
}

interface RosterRow {
  name: string;
  designation: string | null;
  shift_time: string | null;
}

interface AdvisoryRow {
  category: string | null;
  created_at: Date;
  title: string;
}

function rangeStart(range: DashboardRange): Date {
  const now = new Date();
  if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === 'week') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - 6);
    return d;
  }
  return new Date(now.getFullYear(), 0, 1);
}

function minutesAgo(date: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hr${hrs === 1 ? '' : 's'}`;
}

/**
 * Medical Centre dashboard. Visits/beds/OPD-queue/pharmacy KPIs are real,
 * gated behind schema flags so the page degrades gracefully (shows "not
 * tracked yet") until the supporting columns/tables are added — same
 * pattern as every other module in this app. Health advisories reuse the
 * shared `announcements` table (this cell's own posts), rather than a
 * separate table.
 */
@Injectable()
export class MedicalCentreDashboardService {
  private readonly logger = new Logger(MedicalCentreDashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(range: DashboardRange) {
    try {
      const schema = await detectMedicalCentreSchema(this.prisma);
      const since = rangeStart(range);

      const visits = await this.prisma.$queryRaw<VisitRow[]>(Prisma.sql`
        SELECT mv.id, mv.visit_date, mv.reason, mv.diagnosis, mv.treatment_given, mv.referred_to_hospital,
          COALESCE(NULLIF(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))), ''), su.email) AS student_name,
          NULLIF(TRIM(CONCAT(f.first_name, ' ', COALESCE(f.last_name, ''))), '') AS faculty_name,
          ms.name AS staff_name
        FROM medical_visits mv
        LEFT JOIN students s ON s.id = mv.student_id
        LEFT JOIN users su ON su.id = s.user_id
        LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
        LEFT JOIN faculty f ON f.id = mv.faculty_id
        LEFT JOIN medical_staff ms ON ms.id = mv.attended_by_staff_id
        WHERE mv.visit_date >= ${since}
        ORDER BY mv.visit_date DESC, mv.id DESC
      `);

      const referredCount = visits.filter((v) => v.referred_to_hospital).length;
      const totalStudents = await this.prisma.students.count();

      let opdWaiting = 0;
      let opdConsulting = 0;
      if (schema.opdQueue) {
        const statusRows = await this.prisma.$queryRaw<{ status: string; count: bigint }[]>(Prisma.sql`
          SELECT status, count(*) AS count FROM medical_visits
          WHERE visit_date >= ${rangeStart('today')} AND status != 'done'
          GROUP BY status
        `);
        opdWaiting = Number(statusRows.find((r) => r.status === 'waiting')?.count ?? 0);
        opdConsulting = Number(statusRows.find((r) => r.status === 'consult')?.count ?? 0);
      }

      let bedsOccupied = 0;
      let occupiedBeds: { id: string; bedId: number; name: string; reason: string; since: string }[] = [];
      let longestStayMinutes: number | null = null;
      if (schema.sickRoom) {
        const bedRows = await this.prisma.$queryRaw<OccupiedBedRow[]>(Prisma.sql`
          SELECT b.id AS bed_id, b.bed_code, st.reason, st.admitted_at,
            COALESCE(NULLIF(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))), ''), su.email) AS student_name,
            NULLIF(TRIM(CONCAT(f.first_name, ' ', COALESCE(f.last_name, ''))), '') AS faculty_name
          FROM sick_room_stays st
          JOIN sick_room_beds b ON b.id = st.bed_id
          LEFT JOIN medical_visits mv ON mv.id = st.visit_id
          LEFT JOIN students s ON s.id = mv.student_id
          LEFT JOIN users su ON su.id = s.user_id
          LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
          LEFT JOIN faculty f ON f.id = mv.faculty_id
          WHERE st.discharged_at IS NULL
          ORDER BY st.admitted_at ASC
        `);
        bedsOccupied = bedRows.length;
        occupiedBeds = bedRows.map((b) => ({
          id: b.bed_code,
          bedId: b.bed_id,
          name: b.student_name ?? b.faculty_name ?? 'Unrecorded patient',
          reason: b.reason ?? '—',
          since: minutesAgo(b.admitted_at),
        }));
        if (bedRows.length > 0) {
          longestStayMinutes = Math.max(...bedRows.map((b) => Math.round((Date.now() - b.admitted_at.getTime()) / 60_000)));
        }
      }
      const bedsTotal = schema.sickRoom
        ? await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*) AS count FROM sick_room_beds`).then((r) => Number(r[0].count))
        : 0;

      let dispensed = 0;
      let lowStockCount = 0;
      if (schema.pharmacy) {
        const dispensedRows = await this.prisma.$queryRaw<{ total: bigint | null }[]>(Prisma.sql`
          SELECT sum(quantity) AS total FROM pharmacy_dispense_log WHERE dispensed_at >= ${since}
        `);
        dispensed = Number(dispensedRows[0]?.total ?? 0);
        const lowStockRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
          SELECT count(*) AS count FROM pharmacy_stock WHERE quantity <= reorder_level
        `);
        lowStockCount = Number(lowStockRows[0]?.count ?? 0);
      }

      const equipmentUnderService = await this.prisma.medical_equipment.count({ where: { condition: { not: 'working' } } });

      const needsAttention: { title: string; description: string }[] = [];
      if (lowStockCount > 0) needsAttention.push({ title: `${lowStockCount} item${lowStockCount === 1 ? '' : 's'} below reorder level`, description: 'Check the pharmacy stock register' });
      if (equipmentUnderService > 0) needsAttention.push({ title: `${equipmentUnderService} equipment item${equipmentUnderService === 1 ? '' : 's'} under service`, description: 'See the equipment register' });

      const advisories = await this.prisma.$queryRaw<AdvisoryRow[]>(Prisma.sql`
        SELECT a.category, a.created_at, a.title
        FROM announcements a
        JOIN users u ON u.id = a.posted_by_user_id
        JOIN roles r ON r.id = u.role_id
        WHERE r.name = 'medical_centre'
        ORDER BY a.created_at DESC
        LIMIT 4
      `);

      let todaysRoster: { name: string; role: string; shift: string }[] = [];
      if (schema.staffDuty) {
        const rosterRows = await this.prisma.$queryRaw<RosterRow[]>(Prisma.sql`
          SELECT name, designation, shift_time FROM medical_staff WHERE on_duty = true ORDER BY name ASC
        `);
        todaysRoster = rosterRows.map((r) => ({ name: r.name, role: r.designation ?? '—', shift: r.shift_time ?? '—' }));
      }

      const recentTreatmentLog = visits.slice(0, 5).map((v) => ({
        who: v.student_name ?? v.faculty_name ?? 'Unrecorded patient',
        date: v.visit_date.toISOString().slice(0, 10),
        note: [v.reason, v.treatment_given].filter(Boolean).join(' · ') || 'No notes recorded',
        by: v.staff_name ? `Seen by ${v.staff_name}` : 'Attending staff not recorded',
      }));

      const totalVisitBar = Math.min(100, Math.round((visits.length / Math.max(1, totalStudents * 0.15)) * 100));

      const reasonCounts = new Map<string, number>();
      for (const v of visits) {
        if (v.reason) reasonCounts.set(v.reason, (reasonCounts.get(v.reason) ?? 0) + 1);
      }
      const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r]) => r);
      const visitsNote = topReasons.length > 0 ? `${topReasons.join(' · ')} lead the list` : 'No visits recorded in this range';

      return {
        totalStudents,
        extended: schema,
        kpis: {
          visits: visits.length,
          visitsReferred: referredCount,
          visitsBarPercent: totalVisitBar,
          visitsNote,
          bedsOccupied,
          bedsTotal,
          bedsFree: bedsTotal - bedsOccupied,
          bedsBarPercent: bedsTotal > 0 ? Math.round((bedsOccupied / bedsTotal) * 100) : 0,
          longestStayMinutes,
          opdWaiting,
          opdConsulting,
          opdBarPercent: opdWaiting + opdConsulting > 0 ? Math.round((opdConsulting / (opdWaiting + opdConsulting)) * 100) : 0,
          dispensed,
          lowStockCount,
          dispensedBarPercent: schema.pharmacy ? Math.min(100, Math.round((dispensed / 100) * 100)) : 0,
        },
        occupiedBeds,
        needsAttention,
        advisories: advisories.map((a) => ({ tag: a.category ?? 'GENERAL', when: a.created_at.toISOString(), title: a.title })),
        todaysRoster,
        recentTreatmentLog,
      };
    } catch (err) {
      this.logger.error('DB error building medical-centre dashboard', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
