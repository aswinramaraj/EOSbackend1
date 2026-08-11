import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { ReportTable } from 'src/common/utils/report-export.util';
import { IqacReportQueryDto } from './dto/iqac-report-query.dto';
import { VenueHistoryQueryDto } from './dto/venue-history-query.dto';

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
  constructor(private readonly prisma: PrismaService) {}

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
              select: { first_name: true, last_name: true, departments: { select: { name: true } } },
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
          faculty: profile ? `${profile.first_name} ${profile.last_name ?? ''}`.trim() : booker.email,
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
          od_teams: { students: { classes: { department_id: query.department_id } } },
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
                soa_applications: { select: { first_name: true, last_name: true } },
                users: { select: { email: true } },
                classes: { select: { departments: { select: { name: true } } } },
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
        ...(query.department_id && { faculty: { department_id: query.department_id } }),
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
        faculty: `${r.faculty.first_name} ${r.faculty.last_name}`.trim(),
        department: r.faculty.departments.name,
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

    const events: { time: Date; venue: string; what: string; kind: string }[] = [];
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
      if (r.reviewed_at && r.reviewed_at >= dayStart && r.reviewed_at <= dayEnd) {
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
