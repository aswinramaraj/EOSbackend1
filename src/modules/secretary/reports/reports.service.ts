import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { ReportTable } from 'src/common/utils/report-export.util';

/** Shared `{gte, lte}` builder — same shape used by every findAll() in this codebase. */
function dateRangeWhere(
  from?: string,
  to?: string,
): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) {
    return undefined;
  }
  return {
    ...(from && { gte: new Date(from) }),
    ...(to && { lte: new Date(to) }),
  };
}

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

@Injectable()
export class SecretaryReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/secretary/reports/summary — the three pill stats on the Reports
   * page. Scoped to the caller's own data across all four self-service
   * flows, same as the Dashboard summary.
   */
  async summary(userId: number) {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    const [
      productThisMonth,
      serviceThisMonth,
      venueThisMonth,
      mediaThisMonth,
      productPending,
      servicePending,
      venuePending,
      mediaPending,
      upcomingBookings,
    ] = await this.prisma.$transaction([
      this.prisma.secretary_product_requests.count({
        where: { requested_by_user_id: userId, created_at: { gte: monthStart } },
      }),
      this.prisma.secretary_service_requests.count({
        where: { requested_by_user_id: userId, created_at: { gte: monthStart } },
      }),
      this.prisma.venue_bookings.count({
        where: { booked_by_user_id: userId, created_at: { gte: monthStart } },
      }),
      this.prisma.media_requests.count({
        where: { requested_by_user_id: userId, created_at: { gte: monthStart } },
      }),
      this.prisma.secretary_product_requests.count({
        where: { requested_by_user_id: userId, status: 'pending' },
      }),
      this.prisma.secretary_service_requests.count({
        where: { requested_by_user_id: userId, status: 'pending' },
      }),
      this.prisma.venue_bookings.count({
        where: { booked_by_user_id: userId, status: 'pending' },
      }),
      this.prisma.media_requests.count({
        where: { requested_by_user_id: userId, status: 'pending' },
      }),
      this.prisma.venue_bookings.count({
        where: {
          booked_by_user_id: userId,
          status: 'approved',
          from_datetime: { gte: now },
        },
      }),
    ]);

    return {
      requests_this_month:
        productThisMonth + serviceThisMonth + venueThisMonth + mediaThisMonth,
      pending_approvals:
        productPending + servicePending + venuePending + mediaPending,
      upcoming_bookings: upcomingBookings,
    };
  }

  /** 1. PROPOSALS — Product Order Proposals (POP) submitted by this secretary. */
  async productRequests(
    userId: number,
    from?: string,
    to?: string,
    status?: string,
  ): Promise<ReportTable> {
    const requests = await this.prisma.secretary_product_requests.findMany({
      where: {
        requested_by_user_id: userId,
        status: status as never,
        created_at: dateRangeWhere(from, to),
      },
      include: {
        secretary_product_request_items: {
          select: { product_name: true, quantity: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return {
      title: 'Product Order Proposals (POP) report',
      columns: [
        { header: 'ID', key: 'id', width: 8 },
        { header: 'Title', key: 'title', width: 30 },
        { header: 'Items', key: 'items', width: 40 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Submitted', key: 'submitted', width: 14 },
        { header: 'Reviewed', key: 'reviewed', width: 14 },
      ],
      rows: requests.map((r) => ({
        id: r.id,
        title: r.title,
        items: r.secretary_product_request_items
          .map((i) => `${i.product_name} x${i.quantity}`)
          .join(', '),
        status: r.status,
        submitted: formatDate(r.created_at),
        reviewed: formatDate(r.reviewed_at),
      })),
    };
  }

  /** 2. PROPOSALS — Service Order Proposals (SOP) submitted by this secretary. */
  async serviceRequests(
    userId: number,
    from?: string,
    to?: string,
    status?: string,
  ): Promise<ReportTable> {
    const requests = await this.prisma.secretary_service_requests.findMany({
      where: {
        requested_by_user_id: userId,
        status: status as never,
        created_at: dateRangeWhere(from, to),
      },
      include: {
        secretary_service_request_items: { select: { service_name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return {
      title: 'Service Order Proposals (SOP) report',
      columns: [
        { header: 'ID', key: 'id', width: 8 },
        { header: 'Title', key: 'title', width: 30 },
        { header: 'Services', key: 'services', width: 40 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Submitted', key: 'submitted', width: 14 },
        { header: 'Reviewed', key: 'reviewed', width: 14 },
      ],
      rows: requests.map((r) => ({
        id: r.id,
        title: r.title,
        services: r.secretary_service_request_items
          .map((i) => i.service_name)
          .join(', '),
        status: r.status,
        submitted: formatDate(r.created_at),
        reviewed: formatDate(r.reviewed_at),
      })),
    };
  }

  /** 3. VENUE BOOKING — bookings requested by this secretary. */
  async venueBookings(
    userId: number,
    from?: string,
    to?: string,
    status?: string,
  ): Promise<ReportTable> {
    const bookings = await this.prisma.venue_bookings.findMany({
      where: {
        booked_by_user_id: userId,
        status: status as never,
        from_datetime: dateRangeWhere(from, to),
      },
      include: {
        venues_venue_bookings_venue_idTovenues: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return {
      title: 'Venue bookings report',
      columns: [
        { header: 'ID', key: 'id', width: 8 },
        { header: 'Venue', key: 'venue', width: 24 },
        { header: 'Purpose', key: 'purpose', width: 28 },
        { header: 'From', key: 'from', width: 16 },
        { header: 'To', key: 'to', width: 16 },
        { header: 'Status', key: 'status', width: 14 },
      ],
      rows: bookings.map((b) => ({
        id: b.id,
        venue: b.venues_venue_bookings_venue_idTovenues.name,
        purpose: b.purpose,
        from: b.from_datetime.toISOString().slice(0, 16).replace('T', ' '),
        to: b.to_datetime.toISOString().slice(0, 16).replace('T', ' '),
        status: b.status,
      })),
    };
  }

  /** 4. MEDIA REQUEST — media coverage requests submitted by this secretary. */
  async mediaRequests(
    userId: number,
    from?: string,
    to?: string,
    status?: string,
  ): Promise<ReportTable> {
    const requests = await this.prisma.media_requests.findMany({
      where: {
        requested_by_user_id: userId,
        status: status as never,
        created_at: dateRangeWhere(from, to),
      },
      include: { venues: { select: { name: true } } },
      orderBy: { created_at: 'desc' },
    });

    return {
      title: 'Media requests report',
      columns: [
        { header: 'ID', key: 'id', width: 8 },
        { header: 'Event', key: 'event', width: 28 },
        { header: 'Venue', key: 'venue', width: 20 },
        { header: 'Event date', key: 'event_date', width: 14 },
        { header: 'Status', key: 'status', width: 12 },
      ],
      rows: requests.map((r) => ({
        id: r.id,
        event: r.event_name ?? r.description,
        venue: r.venues?.name ?? '',
        event_date: formatDate(r.event_date),
        status: r.status,
      })),
    };
  }

  /**
   * 5. ATTENDANCE SHEETS — attendance records marked by this secretary.
   * Scoped to `marked_by_user_id`, not a college-wide dump — "my reports",
   * matching every other report in this module.
   */
  async attendance(
    userId: number,
    from?: string,
    to?: string,
    status?: string,
  ): Promise<ReportTable> {
    const records = await this.prisma.attendance_records.findMany({
      where: {
        marked_by_user_id: userId,
        status: status as never,
        attendance_date: dateRangeWhere(from, to),
      },
      select: {
        attendance_date: true,
        status: true,
        classes: {
          select: { section: true, departments: { select: { name: true } } },
        },
        subjects: { select: { name: true } },
        students: {
          select: {
            student_id_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
          },
        },
      },
      orderBy: { attendance_date: 'desc' },
    });

    return {
      title: 'Attendance sheets report',
      columns: [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Student', key: 'student', width: 24 },
        { header: 'Class', key: 'class', width: 16 },
        { header: 'Subject', key: 'subject', width: 20 },
        { header: 'Status', key: 'status', width: 10 },
      ],
      rows: records.map((r) => ({
        date: formatDate(r.attendance_date),
        student: r.students.soa_applications
          ? `${r.students.soa_applications.first_name} ${r.students.soa_applications.last_name ?? ''}`.trim()
          : r.students.student_id_no,
        class: `${r.classes.departments.name} ${r.classes.section}`,
        subject: r.subjects?.name ?? '',
        status: r.status,
      })),
    };
  }
}
