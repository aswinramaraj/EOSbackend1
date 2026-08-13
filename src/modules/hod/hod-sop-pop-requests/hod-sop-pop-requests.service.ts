import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

type Kind = 'sop' | 'pop';

function fullName(f: {
  prefix?: string | null;
  first_name: string;
  last_name: string;
}): string {
  return [f.prefix, f.first_name, f.last_name].filter(Boolean).join(' ');
}

function requesterName(
  faculty: { prefix: string | null; first_name: string; last_name: string } | null,
  email: string,
): string {
  return faculty ? fullName(faculty) : email;
}

/** submitted/finance_approved are both still awaiting the HOD's own decision; hod_approved/order_created have already left the HOD's queue. */
function statusOf(raw: string): 'awaiting_hod' | 'sent_to_principal' | 'rejected' {
  if (raw === 'rejected') return 'rejected';
  if (raw === 'hod_approved' || raw === 'order_created') return 'sent_to_principal';
  return 'awaiting_hod';
}

@Injectable()
export class HodSopPopRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveHodDepartment(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true, department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    const department = await this.prisma.departments.findUnique({
      where: { id: faculty.department_id },
      select: { id: true, code: true },
    });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  /** GET /hod/sop-pop-requests */
  async getRequests(userId: number) {
    const department = await this.resolveHodDepartment(userId);

    const [serviceIndents, purchaseIndents] = await Promise.all([
      this.prisma.service_indents.findMany({
        where: { department_id: department.id },
        select: {
          id: true,
          title: true,
          service_description: true,
          needed_by: true,
          status: true,
          created_at: true,
          hod_remarks: true,
          hod_reviewed_at: true,
          users: { select: { email: true, faculty: { select: { prefix: true, first_name: true, last_name: true } } } },
          users_service_indents_hod_reviewed_byTousers: {
            select: { email: true, faculty: { select: { prefix: true, first_name: true, last_name: true } } },
          },
          service_order_proposals: {
            select: { vendors: { select: { item_price: true } } },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.purchase_indents.findMany({
        where: { department_id: department.id },
        select: {
          id: true,
          item_name: true,
          quantity: true,
          purpose: true,
          needed_by: true,
          status: true,
          created_at: true,
          hod_remarks: true,
          hod_reviewed_at: true,
          users: { select: { email: true, faculty: { select: { prefix: true, first_name: true, last_name: true } } } },
          users_purchase_indents_hod_reviewed_byTousers: {
            select: { email: true, faculty: { select: { prefix: true, first_name: true, last_name: true } } },
          },
          purchase_order_proposals: {
            select: { vendors: { select: { item_price: true } } },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    const sop = serviceIndents.map((r) => ({
      id: r.id,
      kind: 'sop' as const,
      display_id: `SOP/${department.code}/${r.created_at.getUTCFullYear()}/${String(r.id).padStart(3, '0')}`,
      title: r.title ?? r.service_description.slice(0, 80),
      description: r.service_description,
      raised_by: requesterName(r.users.faculty, r.users.email),
      raised_by_role: 'Secretary',
      amount: r.service_order_proposals.find((p) => p.vendors?.item_price != null)?.vendors?.item_price
        ? Number(r.service_order_proposals.find((p) => p.vendors?.item_price != null)!.vendors!.item_price)
        : null,
      needed_by: r.needed_by ? r.needed_by.toISOString().slice(0, 10) : null,
      next_stage: 'Principal',
      status: statusOf(r.status),
      raised_at: r.created_at.toISOString().slice(0, 10),
      hod_remarks: r.hod_remarks,
      reviewed_by: r.users_service_indents_hod_reviewed_byTousers
        ? requesterName(r.users_service_indents_hod_reviewed_byTousers.faculty, r.users_service_indents_hod_reviewed_byTousers.email)
        : null,
      reviewed_at: r.hod_reviewed_at ? r.hod_reviewed_at.toISOString().slice(0, 10) : null,
    }));

    const pop = purchaseIndents.map((r) => ({
      id: r.id,
      kind: 'pop' as const,
      display_id: `POP/${department.code}/${r.created_at.getUTCFullYear()}/${String(r.id).padStart(3, '0')}`,
      title: r.item_name,
      description: r.purpose ?? `${r.quantity} unit(s) requested`,
      raised_by: requesterName(r.users.faculty, r.users.email),
      raised_by_role: 'Secretary',
      amount: r.purchase_order_proposals.find((p) => p.vendors?.item_price != null)?.vendors?.item_price
        ? Number(r.purchase_order_proposals.find((p) => p.vendors?.item_price != null)!.vendors!.item_price)
        : null,
      needed_by: r.needed_by ? r.needed_by.toISOString().slice(0, 10) : null,
      next_stage: 'Principal',
      status: statusOf(r.status),
      raised_at: r.created_at.toISOString().slice(0, 10),
      hod_remarks: r.hod_remarks,
      reviewed_by: r.users_purchase_indents_hod_reviewed_byTousers
        ? requesterName(r.users_purchase_indents_hod_reviewed_byTousers.faculty, r.users_purchase_indents_hod_reviewed_byTousers.email)
        : null,
      reviewed_at: r.hod_reviewed_at ? r.hod_reviewed_at.toISOString().slice(0, 10) : null,
    }));

    return {
      counts: { sop: sop.length, pop: pop.length },
      sop,
      pop,
    };
  }

  /** PATCH /hod/sop-pop-requests/:kind/:id */
  async decide(
    userId: number,
    kind: Kind,
    id: number,
    decision: 'approved' | 'rejected',
    remarks?: string,
  ) {
    const department = await this.resolveHodDepartment(userId);
    const newStatus = decision === 'approved' ? 'hod_approved' : 'rejected';
    const reviewStamp = {
      hod_remarks: remarks,
      hod_reviewed_by: userId,
      hod_reviewed_at: new Date(),
    };

    if (kind === 'sop') {
      const indent = await this.prisma.service_indents.findUnique({
        where: { id },
        select: { department_id: true },
      });
      if (!indent || indent.department_id !== department.id) {
        throw new ForbiddenException('This request is not in your department');
      }
      await this.prisma.service_indents.update({
        where: { id },
        data: { status: newStatus, ...reviewStamp },
      });
    } else {
      const indent = await this.prisma.purchase_indents.findUnique({
        where: { id },
        select: { department_id: true },
      });
      if (!indent || indent.department_id !== department.id) {
        throw new ForbiddenException('This request is not in your department');
      }
      await this.prisma.purchase_indents.update({
        where: { id },
        data: { status: newStatus, ...reviewStamp },
      });
    }
    return { status: 'ok' as const };
  }
}
