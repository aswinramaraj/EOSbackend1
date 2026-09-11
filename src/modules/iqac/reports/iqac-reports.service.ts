import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import type { ReportTable } from 'src/common/utils/report-export.util';
import { IqacReportQueryDto } from './dto/iqac-report-query.dto';
import { VenueHistoryQueryDto } from './dto/venue-history-query.dto';
import { IqacAcademicQualityService } from 'src/modules/iqac/academic-quality/iqac-academic-quality.service';
import { IqacStudentDevelopmentService } from 'src/modules/iqac/student-development/iqac-student-development.service';
import { IqacFacultyDevelopmentService } from 'src/modules/iqac/faculty-development/iqac-faculty-development.service';
import { AccreditationService } from 'src/modules/secretary-portal/accreditation/accreditation.service';
import { IqacAccreditationService } from 'src/modules/iqac/accreditation/iqac-accreditation.service';

export interface ScorecardRow {
  domain: string;
  key: string;
  name: string;
  path: string;
  value: number | null;
  unit: '%' | 'count' | null;
  target: number | null;
  attainment: number | null;
  note: string | null;
}

const SCORECARD_METRICS: {
  domain: string;
  key: string;
  name: string;
  path: string;
}[] = [
  {
    domain: 'Academic Quality',
    key: 'attendance',
    name: 'Attendance',
    path: '/iqac/quality/academic/attendance',
  },
  {
    domain: 'Academic Quality',
    key: 'results',
    name: 'Results',
    path: '/iqac/quality/academic/results',
  },
  {
    domain: 'Academic Quality',
    key: 'cgpa',
    name: 'CGPA',
    path: '/iqac/quality/academic/cgpa',
  },
  {
    domain: 'Academic Quality',
    key: 'course-attainment',
    name: 'Course attainment',
    path: '/iqac/quality/academic/course-attainment',
  },
  {
    domain: 'Academic Quality',
    key: 'program-attainment',
    name: 'Program attainment',
    path: '/iqac/quality/academic/program-attainment',
  },
  {
    domain: 'Student Development',
    key: 'placements',
    name: 'Placements',
    path: '/iqac/quality/student/placements',
  },
  {
    domain: 'Student Development',
    key: 'certifications',
    name: 'Certifications',
    path: '/iqac/quality/student/certifications',
  },
  {
    domain: 'Student Development',
    key: 'awards',
    name: 'Awards',
    path: '/iqac/quality/student/awards',
  },
  {
    domain: 'Student Development',
    key: 'competitions',
    name: 'Competitions',
    path: '/iqac/quality/student/competitions',
  },
  {
    domain: 'Student Development',
    key: 'hackathons',
    name: 'Hackathons',
    path: '/iqac/quality/student/hackathons',
  },
  {
    domain: 'Faculty Development',
    key: 'fdp',
    name: 'FDP',
    path: '/iqac/quality/faculty/fdp',
  },
  {
    domain: 'Faculty Development',
    key: 'sttp',
    name: 'STTP',
    path: '/iqac/quality/faculty/sttp',
  },
  {
    domain: 'Faculty Development',
    key: 'faculty-certifications',
    name: 'Certifications',
    path: '/iqac/quality/faculty/certifications',
  },
  {
    domain: 'Faculty Development',
    key: 'publications',
    name: 'Publications',
    path: '/iqac/quality/faculty/publications',
  },
  {
    domain: 'Faculty Development',
    key: 'research',
    name: 'Research',
    path: '/iqac/quality/faculty/research',
  },
  {
    domain: 'Faculty Development',
    key: 'patents',
    name: 'Patents',
    path: '/iqac/quality/faculty/patents',
  },
  {
    domain: 'Accreditation',
    key: 'naac-progress',
    name: 'NAAC progress',
    path: '/iqac/quality/accreditation/naac-progress',
  },
  {
    domain: 'Accreditation',
    key: 'nba-progress',
    name: 'NBA progress',
    path: '/iqac/quality/accreditation/nba-progress',
  },
  {
    domain: 'Accreditation',
    key: 'aqar-progress',
    name: 'AQAR progress',
    path: '/iqac/quality/accreditation/aqar-progress',
  },
  {
    domain: 'Accreditation',
    key: 'ssr-progress',
    name: 'SSR progress',
    path: '/iqac/quality/accreditation/ssr-progress',
  },
];

function dateRangeWhere(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    ...(from && { gte: new Date(from) }),
    ...(to && { lte: new Date(to) }),
  };
}

/** Same fallback chain used everywhere else in this codebase - no generic display-name column on `students`/`faculty`. */
function resolveStudentName(student: {
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
}): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

/**
 * Cross-cutting IQAC admin-portal reports over venue bookings and student/
 * faculty on-duty requests - the same underlying tables VenuesService/
 * IqacStudentOdsService/FacultyOdService already expose for review, just
 * shaped into ReportTable for the Reports screen's date-range download
 * builder. Kept in its own `iqac` domain rather than folded into any one of
 * those modules, since a report here always spans more than one resource.
 */
@Injectable()
export class IqacReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly academicQuality: IqacAcademicQualityService,
    private readonly studentDevelopment: IqacStudentDevelopmentService,
    private readonly facultyDevelopment: IqacFacultyDevelopmentService,
    private readonly accreditation: AccreditationService,
    private readonly iqacAccreditation: IqacAccreditationService,
  ) {}

  private async targetFor(metricKey: string): Promise<number | null> {
    const today = new Date();
    const month = today.getUTCMonth() + 1;
    const start =
      month >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
    const academicYear = `${start}-${start + 1}`;
    const row = await this.prisma.iqac_metric_targets.findUnique({
      where: {
        metric_key_academic_year: {
          metric_key: metricKey,
          academic_year: academicYear,
        },
      },
    });
    return row ? Number(row.target_value) : null;
  }

  /**
   * GET /iqac/reports/scorecard
   *
   * Flattens every real metric already built across the 4 Quality domains
   * into one table, matching the reference design's "Institution
   * scorecard". Reuses the exact same "this year" sources each metric's own
   * page now shows — results/grade-distribution auto-resolve the latest
   * real exam institution-wide (no more "select an exam" placeholder here),
   * and placements/awards/publications reuse their real quality()
   * endpoints (real counts, not the old all-time totals) — so this table
   * never drifts from what IQAC sees on the metric's own page. Every row
   * with no real backing still shows null, not a guess.
   */
  async scorecard(user: JwtPayload): Promise<{
    rows: ScorecardRow[];
    kpi_score: number | null;
  }> {
    const [
      attendance,
      results,
      gradeDistribution,
      courseAttainment,
      programAttainment,
      placementsQuality,
      certificationsQuality,
      awardsQuality,
      competitionsQuality,
      hackathonsQuality,
      fdpQuality,
      sttpQuality,
      facultyCertificationsQuality,
      publicationsQuality,
      researchQuality,
      patentsQuality,
      nbaOverview,
      naacReadiness,
      aqarReadiness,
      ssrReadiness,
    ] = await Promise.all([
      this.academicQuality.attendance(),
      this.academicQuality.results(),
      this.academicQuality.gradeDistribution(),
      this.academicQuality.courseAttainment(),
      this.academicQuality.programAttainment(),
      this.studentDevelopment.placementsQuality(),
      this.studentDevelopment.certificationsQuality(),
      this.studentDevelopment.awardsQuality(),
      this.studentDevelopment.competitionsQuality(),
      this.studentDevelopment.hackathonsQuality(),
      this.facultyDevelopment.fdpQuality(),
      this.facultyDevelopment.sttpQuality(),
      this.facultyDevelopment.facultyCertificationsQuality(),
      this.facultyDevelopment.publicationsQuality(),
      this.facultyDevelopment.researchQuality(),
      this.facultyDevelopment.patentsQuality(),
      this.accreditation.getOverview(user),
      this.iqacAccreditation.meanReadiness('naac'),
      this.iqacAccreditation.meanReadiness('aqar'),
      this.iqacAccreditation.meanReadiness('ssr'),
    ]);

    const REAL_VALUES: Record<
      string,
      {
        value: number | null;
        unit: '%' | 'count';
        note?: string;
        /** Only set for metrics with their own real per-item target (course/program attainment) instead of an iqac_metric_targets row. */
        target?: number | null;
        attainment?: number | null;
      }
    > = {
      attendance: { value: attendance.this_year, unit: '%' },
      results: {
        value: results.overall_pass_percentage,
        unit: '%',
        note: results.exam ? undefined : 'No exam with entered marks yet',
      },
      cgpa: {
        value: gradeDistribution.mean_grade_point,
        unit: 'count',
        note: gradeDistribution.exam
          ? 'mean grade point, latest exam'
          : 'No exam with graded marks yet',
      },
      'course-attainment': {
        value: courseAttainment.mean_attained,
        unit: 'count',
        // Real mean of each CO's own target_value — no institution-wide
        // iqac_metric_targets entry exists for this domain, matching the
        // page's own card (see courseAttainment()'s own doc comment).
        target: courseAttainment.mean_target,
        attainment: courseAttainment.attainment_percentage,
        note:
          courseAttainment.mean_attained == null
            ? 'No outcomes recorded yet'
            : 'mean attained, 3-pt NBA scale',
      },
      'program-attainment': {
        value: programAttainment.mean_attained,
        unit: 'count',
        target: programAttainment.mean_target,
        attainment: programAttainment.attainment_percentage,
        note:
          programAttainment.mean_attained == null
            ? 'No outcomes recorded yet'
            : 'mean attained, 3-pt NBA scale',
      },
      placements: {
        value: placementsQuality.this_year,
        unit: 'count',
        note: 'real offers this AY, by drive date',
      },
      certifications: {
        value: certificationsQuality.this_year,
        unit: 'count',
        note: 'student certifications completed this AY',
      },
      awards: {
        value: awardsQuality.this_year,
        unit: 'count',
        note: 'sports achievements this AY',
      },
      competitions: {
        value: competitionsQuality.this_year,
        unit: 'count',
        note: 'student competitions this AY',
      },
      hackathons: {
        value: hackathonsQuality.this_year,
        unit: 'count',
        note: 'student hackathons this AY',
      },
      fdp: {
        value: fdpQuality.this_year,
        unit: 'count',
        note: 'faculty development programmes attended this AY',
      },
      sttp: {
        value: sttpQuality.this_year,
        unit: 'count',
        note: 'short-term training programmes attended this AY',
      },
      'faculty-certifications': {
        value: facultyCertificationsQuality.this_year,
        unit: 'count',
        note: 'faculty certifications completed this AY',
      },
      publications: {
        value: publicationsQuality.this_year,
        unit: 'count',
        note: 'papers this calendar year',
      },
      research: {
        value: researchQuality.this_year,
        unit: 'count',
        note: 'research project memberships this AY',
      },
      patents: {
        value: patentsQuality.this_year,
        unit: 'count',
        note: 'patents filed this calendar year',
      },
      'nba-progress': { value: nbaOverview.readiness_pct, unit: '%' },
      'naac-progress': {
        value: naacReadiness,
        unit: '%',
        note:
          naacReadiness == null
            ? 'No NAAC checklist items on file yet'
            : 'self-reported readiness, not a certified score',
      },
      'aqar-progress': {
        value: aqarReadiness,
        unit: '%',
        note:
          aqarReadiness == null
            ? 'No AQAR checklist items on file yet'
            : 'self-reported readiness, not a certified score',
      },
      'ssr-progress': {
        value: ssrReadiness,
        unit: '%',
        note:
          ssrReadiness == null
            ? 'No SSR checklist items on file yet'
            : 'self-reported readiness, not a certified score',
      },
    };

    const rows = await Promise.all(
      SCORECARD_METRICS.map(async (m) => {
        const real = REAL_VALUES[m.key];
        const target =
          real?.target !== undefined ? real.target : real ? await this.targetFor(m.key) : null;
        const attainment =
          real?.attainment !== undefined
            ? real.attainment
            : real?.value != null && target != null
              ? Math.round((real.value / target) * 1000) / 10
              : null;
        return {
          domain: m.domain,
          key: m.key,
          name: m.name,
          path: m.path,
          value: real?.value ?? null,
          unit: real?.unit ?? null,
          target,
          attainment,
          note:
            real?.note ?? (real ? null : 'Not computable from current data'),
        };
      }),
    );

    const attainments = rows
      .map((r) => r.attainment)
      .filter((v): v is number => v != null);
    const kpiScore =
      attainments.length > 0
        ? Math.round(
            attainments.reduce((a, b) => a + b, 0) / attainments.length,
          )
        : null;

    return { rows, kpi_score: kpiScore };
  }

  async venueBookingsReport(query: IqacReportQueryDto): Promise<ReportTable> {
    const rows = await this.prisma.venue_bookings.findMany({
      where: {
        from_datetime: dateRangeWhere(query.from, query.to),
        ...(query.department_id && {
          users_venue_bookings_booked_by_user_idTousers: {
            OR: [
              { faculty: { department_id: query.department_id } },
              {
                non_teaching_staff: {
                  some: { department_id: query.department_id },
                },
              },
            ],
          },
        }),
      },
      orderBy: { from_datetime: 'asc' },
      select: {
        purpose: true,
        from_datetime: true,
        to_datetime: true,
        status: true,
        venues_venue_bookings_venue_idTovenues: { select: { name: true } },
        users_venue_bookings_booked_by_user_idTousers: {
          select: {
            email: true,
            faculty: {
              select: {
                first_name: true,
                last_name: true,
                departments: { select: { name: true } },
              },
            },
            non_teaching_staff: {
              select: {
                first_name: true,
                last_name: true,
                departments: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    return {
      title: 'Venue Bookings',
      columns: [
        { header: 'Faculty', key: 'faculty' },
        { header: 'Department', key: 'department' },
        { header: 'Venue', key: 'venue' },
        { header: 'Purpose', key: 'purpose' },
        { header: 'From', key: 'from' },
        { header: 'To', key: 'to' },
        { header: 'Status', key: 'status' },
      ],
      rows: rows.map((r) => {
        const booker = r.users_venue_bookings_booked_by_user_idTousers;
        const staff = booker.non_teaching_staff[0];
        const profile = booker.faculty ?? staff ?? null;
        return {
          faculty: profile
            ? `${profile.first_name} ${profile.last_name ?? ''}`.trim()
            : booker.email,
          department: booker.faculty
            ? (booker.faculty.departments?.name ?? '')
            : (staff?.departments?.name ?? ''),
          venue: r.venues_venue_bookings_venue_idTovenues.name,
          purpose: r.purpose,
          from: r.from_datetime.toISOString(),
          to: r.to_datetime.toISOString(),
          status: r.status,
        };
      }),
    };
  }

  async studentOdsReport(query: IqacReportQueryDto): Promise<ReportTable> {
    const rows = await this.prisma.od_requests.findMany({
      where: {
        from_date: dateRangeWhere(query.from, query.to),
        ...(query.department_id && {
          od_teams: {
            students: { classes: { department_id: query.department_id } },
          },
        }),
      },
      orderBy: { from_date: 'asc' },
      select: {
        from_date: true,
        to_date: true,
        reason: true,
        mentor_approval_status: true,
        verification_status: true,
        od_teams: {
          select: {
            students: {
              select: {
                soa_applications: {
                  select: { first_name: true, last_name: true },
                },
                users: { select: { email: true } },
                classes: {
                  select: { departments: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
    });

    return {
      title: 'Student On-Duty Requests',
      columns: [
        { header: 'Student', key: 'student' },
        { header: 'Department', key: 'department' },
        { header: 'From', key: 'from' },
        { header: 'To', key: 'to' },
        { header: 'Reason', key: 'reason' },
        { header: 'Mentor status', key: 'mentor_status' },
        { header: 'Verification', key: 'verification' },
      ],
      rows: rows.map((r) => ({
        student: resolveStudentName(r.od_teams.students),
        department: r.od_teams.students.classes?.departments.name ?? '',
        from: r.from_date.toISOString().slice(0, 10),
        to: r.to_date.toISOString().slice(0, 10),
        reason: r.reason ?? '',
        mentor_status: r.mentor_approval_status,
        verification: r.verification_status,
      })),
    };
  }

  async facultyOdsReport(query: IqacReportQueryDto): Promise<ReportTable> {
    const rows = await this.prisma.faculty_od_requests.findMany({
      where: {
        from_date: dateRangeWhere(query.from, query.to),
        ...(query.department_id && {
          faculty: { department_id: query.department_id },
        }),
      },
      orderBy: { from_date: 'asc' },
      select: {
        from_date: true,
        to_date: true,
        purpose: true,
        hod_approval_status: true,
        hr_approval_status: true,
        verification_status: true,
        faculty: {
          select: {
            first_name: true,
            last_name: true,
            departments: { select: { name: true } },
          },
        },
      },
    });

    return {
      title: 'Faculty On-Duty Requests',
      columns: [
        { header: 'Faculty', key: 'faculty' },
        { header: 'Department', key: 'department' },
        { header: 'From', key: 'from' },
        { header: 'To', key: 'to' },
        { header: 'Purpose', key: 'purpose' },
        { header: 'HoD status', key: 'hod_status' },
        { header: 'HR status', key: 'hr_status' },
        { header: 'Verification', key: 'verification' },
      ],
      rows: rows.map((r) => ({
        faculty: r.faculty
          ? `${r.faculty.first_name} ${r.faculty.last_name}`.trim()
          : 'Staff',
        department: r.faculty?.departments?.name ?? '—',
        from: r.from_date.toISOString().slice(0, 10),
        to: r.to_date.toISOString().slice(0, 10),
        purpose: r.purpose ?? '',
        hod_status: r.hod_approval_status,
        hr_status: r.hr_approval_status,
        verification: r.verification_status,
      })),
    };
  }

  /**
   * GET /iqac/reports/venue-history?date= — a real-data, simplified stand-in
   * for the admin portal's richer mocked timeline (per your decision):
   * booking-lifecycle events only (requested / decided), built from
   * venue_bookings.created_at and reviewed_at, not a new activity-log table.
   */
  async venueHistory(query: VenueHistoryQueryDto) {
    const dayStart = new Date(query.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(query.date);
    dayEnd.setHours(23, 59, 59, 999);

    const rows = await this.prisma.venue_bookings.findMany({
      where: {
        OR: [
          { created_at: { gte: dayStart, lte: dayEnd } },
          { reviewed_at: { gte: dayStart, lte: dayEnd } },
        ],
      },
      select: {
        purpose: true,
        status: true,
        created_at: true,
        reviewed_at: true,
        venues_venue_bookings_venue_idTovenues: { select: { name: true } },
      },
    });

    const events: { time: Date; venue: string; what: string; kind: string }[] =
      [];
    for (const r of rows) {
      const venue = r.venues_venue_bookings_venue_idTovenues.name;
      if (r.created_at >= dayStart && r.created_at <= dayEnd) {
        events.push({
          time: r.created_at,
          venue,
          what: `Booking requested — ${r.purpose}`,
          kind: 'request',
        });
      }
      if (
        r.reviewed_at &&
        r.reviewed_at >= dayStart &&
        r.reviewed_at <= dayEnd
      ) {
        events.push({
          time: r.reviewed_at,
          venue,
          what: `Booking ${r.status.replace('_', ' ')} — ${r.purpose}`,
          kind: r.status,
        });
      }
    }

    events.sort((a, b) => a.time.getTime() - b.time.getTime());
    return events;
  }
}
