import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { ReportTable } from 'src/common/utils/report-export.util';

export interface ScorecardRow {
  [key: string]: string;
  metric: string;
  this_year: string;
  last_year: string;
  target: string;
  attainment: string;
}

interface ComputedMetrics {
  studentsTotalActive: number;
  attendancePct: number | null;
  attendanceDetail: string;
  placementPct: number | null;
  placementDetail: string;
  facultyWithPhd: number;
  facultyTotalActive: number;
  feeRecoveryPct: number | null;
  feeDetail: string;
}

const NOT_AVAILABLE = '—';

@Injectable()
export class PrincipalReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reference design's scorecard has 5 columns (Metric / This year / Last
   * year / Target / Attainment) and 8 rows. The row/column layout is kept
   * exact. What's real, checked live against this database:
   *  - "This year" is real for 5 rows (Student strength, Mean attendance,
   *    Placement percentage, Faculty with PhD, Fee recovery).
   *  - "Last year" is "—" for every row — attendance_records spans ~1 week,
   *    student_fee_demand_mapping has one academic_year in the whole table
   *    (2022-2023, unrelated to now), placement_drives is all current-year,
   *    and there is no historical headcount snapshot anywhere.
   *  - "Target" and "Attainment" are "—" for every row — no target figure
   *    for anything here exists anywhere in the schema.
   *  - Pass percentage, Publications (Scopus), NBA/NAAC documentation are
   *    "—" across the whole row: no table tracks exam pass/fail correctly
   *    (exam_marks has no internal/external split to apply
   *    exam_pass_rules_settings to), publications, or accreditation
   *    documentation.
   * None of the above is guessed to fill the layout — every "—" is a real
   * "not tracked", not a placeholder standing in for a number.
   */
  async scorecard(): Promise<ReportTable> {
    const rows = await this.scorecardRows();
    return {
      title: 'Institution scorecard',
      columns: [
        { header: 'Metric', key: 'metric', width: 26 },
        { header: 'This year', key: 'this_year', width: 14 },
        { header: 'Last year', key: 'last_year', width: 14 },
        { header: 'Target', key: 'target', width: 12 },
        { header: 'Attainment', key: 'attainment', width: 12 },
      ],
      rows,
    };
  }

  /** GET /me/principal/reports/summary — the 3 headline cards. */
  async summary() {
    const m = await this.computeMetrics();
    return {
      mean_attendance: {
        label: 'Mean attendance',
        value: pct(m.attendancePct),
        detail: m.attendanceDetail,
      },
      placement_rate: {
        label: 'Placement rate',
        value: pct(m.placementPct),
        detail: m.placementDetail,
      },
      fee_recovery: {
        label: 'Fee recovery',
        value: pct(m.feeRecoveryPct),
        detail: m.feeDetail,
      },
    };
  }

  private async scorecardRows(): Promise<ScorecardRow[]> {
    const m = await this.computeMetrics();
    const notTracked = (metric: string): ScorecardRow => ({
      metric,
      this_year: NOT_AVAILABLE,
      last_year: NOT_AVAILABLE,
      target: NOT_AVAILABLE,
      attainment: NOT_AVAILABLE,
    });

    return [
      {
        metric: 'Student strength',
        this_year: m.studentsTotalActive.toLocaleString('en-IN'),
        last_year: NOT_AVAILABLE,
        target: NOT_AVAILABLE,
        attainment: NOT_AVAILABLE,
      },
      {
        metric: 'Mean attendance',
        this_year: pct(m.attendancePct),
        last_year: NOT_AVAILABLE,
        target: NOT_AVAILABLE,
        attainment: NOT_AVAILABLE,
      },
      notTracked('Pass percentage'),
      {
        metric: 'Placement percentage',
        this_year: pct(m.placementPct),
        last_year: NOT_AVAILABLE,
        target: NOT_AVAILABLE,
        attainment: NOT_AVAILABLE,
      },
      {
        metric: 'Faculty with PhD',
        this_year: `${m.facultyWithPhd} / ${m.facultyTotalActive}`,
        last_year: NOT_AVAILABLE,
        target: NOT_AVAILABLE,
        attainment: NOT_AVAILABLE,
      },
      notTracked('Publications (Scopus)'),
      {
        metric: 'Fee recovery',
        this_year: pct(m.feeRecoveryPct),
        last_year: NOT_AVAILABLE,
        target: NOT_AVAILABLE,
        attainment: NOT_AVAILABLE,
      },
      notTracked('NBA / NAAC documentation'),
    ];
  }

  private async computeMetrics(): Promise<ComputedMetrics> {
    const [
      studentsTotalActive,
      facultyTotalActive,
      facultyWithPhd,
      attendanceAgg,
      attendanceRange,
      registeredStudentIds,
      placedApplications,
      feeDemandAgg,
      feePaidAgg,
      feeAcademicYears,
    ] = await Promise.all([
      this.prisma.students.count({ where: { status: 'active' } }),
      this.prisma.faculty.count({ where: { status: 'active' } }),
      this.prisma.faculty.count({
        where: {
          status: 'active',
          qualification: { contains: 'ph.d', mode: 'insensitive' },
        },
      }),
      this.prisma.attendance_records.groupBy({ by: ['status'], _count: true }),
      this.prisma.attendance_records.aggregate({
        _min: { attendance_date: true },
        _max: { attendance_date: true },
      }),
      this.prisma.student_drive_applications.findMany({
        select: { student_id: true },
        distinct: ['student_id'],
      }),
      this.prisma.student_drive_applications.count({
        where: { status: 'placed' },
      }),
      this.prisma.student_fee_demand_mapping.aggregate({
        _sum: { total_amount: true },
      }),
      this.prisma.fee_payments.aggregate({ _sum: { amount_paid: true } }),
      this.prisma.student_fee_demand_mapping.findMany({
        select: { academic_year: true },
        distinct: ['academic_year'],
      }),
    ]);

    const presentCount =
      attendanceAgg.find((r) => r.status === 'present')?._count ?? 0;
    const markedTotal = attendanceAgg.reduce((sum, r) => sum + r._count, 0);
    const attendancePct =
      markedTotal > 0
        ? Math.round((presentCount / markedTotal) * 1000) / 10
        : null;
    const attendanceDetail =
      attendanceRange._min.attendance_date &&
      attendanceRange._max.attendance_date
        ? `recorded ${attendanceRange._min.attendance_date.toISOString().slice(0, 10)} to ${attendanceRange._max.attendance_date.toISOString().slice(0, 10)}`
        : 'no attendance recorded yet';

    const registered = registeredStudentIds.length;
    const placementPct =
      registered > 0
        ? Math.round((placedApplications / registered) * 1000) / 10
        : null;
    const placementDetail =
      registered > 0
        ? `${placedApplications} / ${registered} registered students placed`
        : 'no drive applications yet';

    const demand = Number(feeDemandAgg._sum.total_amount ?? 0);
    const paid = Number(feePaidAgg._sum.amount_paid ?? 0);
    const feeRecoveryPct =
      demand > 0 ? Math.round((paid / demand) * 1000) / 10 : null;
    const feeYearsLabel =
      feeAcademicYears.map((y) => y.academic_year).join(', ') ||
      'no fee demand data yet';
    const feeDetail = `AY ${feeYearsLabel} · ₹${(paid / 1e5).toFixed(1)}L collected of ₹${(demand / 1e5).toFixed(1)}L demanded`;

    return {
      studentsTotalActive,
      attendancePct,
      attendanceDetail,
      placementPct,
      placementDetail,
      facultyWithPhd,
      facultyTotalActive,
      feeRecoveryPct,
      feeDetail,
    };
  }
}

function pct(value: number | null): string {
  return value != null ? `${value}%` : NOT_AVAILABLE;
}
