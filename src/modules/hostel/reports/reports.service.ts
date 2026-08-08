import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import type { ReportTable } from 'src/common/utils/report-export.util';

function residentName(student: {
  student_id_no: string;
  soa_applications: { first_name: string; last_name: string | null } | null;
}): string {
  return student.soa_applications
    ? `${student.soa_applications.first_name} ${student.soa_applications.last_name ?? ''}`.trim()
    : `Student ${student.student_id_no}`;
}

@Injectable()
export class HostelReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 1. OCCUPANCY — beds/rooms per hostel block. */
  async occupancy(hostelId?: number): Promise<ReportTable> {
    const hostels = await this.prisma.hostels.findMany({
      where: hostelId ? { id: hostelId } : {},
      include: {
        hostel_rooms: {
          select: {
            capacity: true,
            _count: { select: { student_hostel_mapping: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return {
      title: 'Occupancy report',
      columns: [
        { header: 'Hostel', key: 'hostel', width: 20 },
        { header: 'Code', key: 'code', width: 10 },
        { header: 'Wing', key: 'wing', width: 10 },
        { header: 'Rooms', key: 'rooms', width: 10 },
        { header: 'Capacity', key: 'capacity', width: 10 },
        { header: 'Occupied', key: 'occupied', width: 10 },
        { header: 'Vacant', key: 'vacant', width: 10 },
        { header: 'Occupancy %', key: 'occupancy_pct', width: 12 },
      ],
      rows: hostels.map((h) => {
        const capacity = h.hostel_rooms.reduce((sum, r) => sum + r.capacity, 0);
        const occupied = h.hostel_rooms.reduce(
          (sum, r) => sum + r._count.student_hostel_mapping,
          0,
        );
        return {
          hostel: h.name,
          code: h.code,
          wing: h.wing,
          rooms: h.hostel_rooms.length,
          capacity,
          occupied,
          vacant: capacity - occupied,
          occupancy_pct:
            capacity > 0 ? Math.round((occupied / capacity) * 1000) / 10 : 0,
        };
      }),
    };
  }

  /** 2. FEE COLLECTION & ARREARS — per-resident hostel fee position. */
  async feeArrears(hostelId?: number): Promise<ReportTable> {
    const mappings = await this.prisma.student_hostel_mapping.findMany({
      where: {
        fee_structure_id: { not: null },
        ...(hostelId ? { hostel_rooms: { hostel_id: hostelId } } : {}),
      },
      include: {
        students: {
          select: {
            student_id_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            student_fee_demand_mapping: {
              select: {
                fee_structure_id: true,
                total_amount: true,
                fee_payments: { select: { amount_paid: true } },
              },
            },
          },
        },
        hostel_rooms: { select: { room_number: true } },
      },
    });

    const rows = mappings.map((mapping) => {
      const student = mapping.students;
      const relevantDemands = student.student_fee_demand_mapping.filter(
        (d) => d.fee_structure_id === mapping.fee_structure_id,
      );
      const totalAmount = relevantDemands.reduce(
        (sum, d) => sum + Number(d.total_amount),
        0,
      );
      const paidAmount = relevantDemands.reduce(
        (sum, d) =>
          sum + d.fee_payments.reduce((s, p) => s + Number(p.amount_paid), 0),
        0,
      );

      return {
        student: residentName(student),
        student_id_no: student.student_id_no,
        room: mapping.hostel_rooms.room_number,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        balance: totalAmount - paidAmount,
        status:
          paidAmount >= totalAmount && totalAmount > 0
            ? 'Paid'
            : paidAmount > 0
              ? 'Partially paid'
              : 'Unpaid',
      };
    });

    return {
      title: 'Fee collection & arrears report',
      columns: [
        { header: 'Student', key: 'student', width: 22 },
        { header: 'Student ID', key: 'student_id_no', width: 14 },
        { header: 'Room', key: 'room', width: 10 },
        { header: 'Total', key: 'total_amount', width: 12 },
        { header: 'Paid', key: 'paid_amount', width: 12 },
        { header: 'Balance', key: 'balance', width: 12 },
        { header: 'Status', key: 'status', width: 14 },
      ],
      rows,
    };
  }

  /** 3. LEAVE / GATE AUDIT — every outing request in the period. */
  async leaveAudit(
    hostelId?: number,
    from?: string,
    to?: string,
  ): Promise<ReportTable> {
    const where: Prisma.hostel_outingsWhereInput = {};
    if (hostelId) {
      where.students = {
        student_hostel_mapping: { hostel_rooms: { hostel_id: hostelId } },
      };
    }
    if (from || to) {
      where.from_date = {};
      if (from) where.from_date.gte = new Date(from);
      if (to) where.from_date.lte = new Date(to);
    }

    const outings = await this.prisma.hostel_outings.findMany({
      where,
      include: {
        students: {
          select: {
            student_id_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            student_hostel_mapping: {
              select: { hostel_rooms: { select: { room_number: true } } },
            },
          },
        },
        users: { select: { email: true } },
      },
      orderBy: { from_date: 'desc' },
    });

    return {
      title: 'Leave / gate audit report',
      columns: [
        { header: 'Student', key: 'student', width: 22 },
        { header: 'Room', key: 'room', width: 10 },
        { header: 'From', key: 'from_date', width: 14 },
        { header: 'To', key: 'to_date', width: 14 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Decided by', key: 'decided_by', width: 22 },
      ],
      rows: outings.map((o) => ({
        student: residentName(o.students),
        room: o.students.student_hostel_mapping?.hostel_rooms.room_number ?? '',
        from_date: o.from_date.toISOString().slice(0, 10),
        to_date: o.to_date.toISOString().slice(0, 10),
        status: o.status,
        decided_by: o.users?.email ?? '',
      })),
    };
  }

  /** 4. COMPLAINT SLA — every complaint, its resolution state and timing. */
  async complaintSla(hostelId?: number): Promise<ReportTable> {
    const complaints = await this.prisma.hostel_complaints.findMany({
      where: hostelId ? { hostel_id: hostelId } : {},
      include: {
        students: {
          select: {
            student_id_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return {
      title: 'Complaint SLA report',
      columns: [
        { header: 'Raised by', key: 'raised_by', width: 22 },
        { header: 'Category', key: 'category', width: 14 },
        { header: 'Title', key: 'title', width: 28 },
        { header: 'Priority', key: 'priority', width: 10 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Raised', key: 'created_at', width: 14 },
        { header: 'Resolved', key: 'resolved_at', width: 14 },
      ],
      rows: complaints.map((c) => ({
        raised_by: residentName(c.students),
        category: c.category,
        title: c.title,
        priority: c.priority,
        status: c.status,
        created_at: c.created_at.toISOString().slice(0, 10),
        resolved_at: c.resolved_at
          ? c.resolved_at.toISOString().slice(0, 10)
          : '',
      })),
    };
  }
}
