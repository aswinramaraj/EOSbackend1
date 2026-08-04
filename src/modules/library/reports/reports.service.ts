import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import type { ReportTable } from './report-export.util';

const BORROW_RECORD_REPORT_INCLUDE = {
  books: { select: { title: true, qr_code: true } },
  students: {
    select: {
      student_id_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      courses: {
        select: { departments: { select: { id: true, name: true } } },
      },
    },
  },
  faculty: {
    select: {
      first_name: true,
      last_name: true,
      department_id: true,
      departments: { select: { name: true } },
    },
  },
} satisfies Prisma.book_borrow_recordsInclude;

type BorrowRecordForReport = Prisma.book_borrow_recordsGetPayload<{
  include: typeof BORROW_RECORD_REPORT_INCLUDE;
}>;

function borrowerName(record: BorrowRecordForReport): string {
  if (record.students) {
    return record.students.soa_applications
      ? `${record.students.soa_applications.first_name} ${record.students.soa_applications.last_name ?? ''}`.trim()
      : `Student ${record.students.student_id_no}`;
  }
  if (record.faculty) {
    return `${record.faculty.first_name} ${record.faculty.last_name}`;
  }
  return '—';
}

function borrowerDepartment(record: BorrowRecordForReport): {
  id: number | null;
  name: string;
} {
  if (record.students) {
    return {
      id: record.students.courses.departments.id,
      name: record.students.courses.departments.name,
    };
  }
  if (record.faculty) {
    return {
      id: record.faculty.department_id,
      name: record.faculty.departments.name,
    };
  }
  return { id: null, name: '—' };
}

@Injectable()
export class LibraryReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 1. INVENTORY — every title with copies, rack position, cost, availability. */
  async inventory(departmentId?: number): Promise<ReportTable> {
    const books = await this.prisma.books.findMany({
      where: departmentId ? { department_id: departmentId } : {},
      include: {
        book_categories: { select: { name: true } },
        departments: { select: { name: true } },
        library_racks: { select: { rack_code: true } },
      },
      orderBy: { title: 'asc' },
    });

    return {
      title: 'Book inventory report',
      columns: [
        { header: 'Accession', key: 'accession', width: 16 },
        { header: 'Title', key: 'title', width: 32 },
        { header: 'Author', key: 'author', width: 20 },
        { header: 'Category', key: 'category', width: 18 },
        { header: 'Department', key: 'department', width: 18 },
        { header: 'Rack', key: 'rack', width: 10 },
        { header: 'Total copies', key: 'total_copies', width: 12 },
        { header: 'Available', key: 'available_copies', width: 10 },
        { header: 'Price/copy', key: 'price_per_copy', width: 12 },
      ],
      rows: books.map((b) => ({
        accession: b.qr_code,
        title: b.title,
        author: b.author ?? '',
        category: b.book_categories.name,
        department: b.departments?.name ?? '',
        rack: b.library_racks?.rack_code ?? '',
        total_copies: b.total_copies,
        available_copies: b.available_copies,
        price_per_copy:
          b.price_per_copy !== null ? Number(b.price_per_copy) : '',
      })),
    };
  }

  /** 2. CIRCULATION — issued books report: borrowings in period. */
  async issued(
    from?: string,
    to?: string,
    departmentId?: number,
  ): Promise<ReportTable> {
    const where: Prisma.book_borrow_recordsWhereInput = {};
    if (from || to) {
      where.borrowed_date = {};
      if (from) where.borrowed_date.gte = new Date(from);
      if (to) where.borrowed_date.lte = new Date(to);
    }

    let records = await this.prisma.book_borrow_records.findMany({
      where,
      include: BORROW_RECORD_REPORT_INCLUDE,
      orderBy: { borrowed_date: 'desc' },
    });

    if (departmentId) {
      records = records.filter(
        (r) => borrowerDepartment(r).id === departmentId,
      );
    }

    return {
      title: 'Issued books report',
      columns: [
        { header: 'Accession', key: 'accession', width: 16 },
        { header: 'Title', key: 'title', width: 28 },
        { header: 'Borrower', key: 'borrower', width: 22 },
        { header: 'Department', key: 'department', width: 18 },
        { header: 'Borrowed', key: 'borrowed_date', width: 14 },
        { header: 'Due', key: 'due_date', width: 14 },
        { header: 'Status', key: 'status', width: 12 },
      ],
      rows: records.map((r) => ({
        accession: r.books.qr_code,
        title: r.books.title,
        borrower: borrowerName(r),
        department: borrowerDepartment(r).name,
        borrowed_date: r.borrowed_date.toISOString().slice(0, 10),
        due_date: r.due_date.toISOString().slice(0, 10),
        status: r.status,
      })),
    };
  }

  /** 3. CIRCULATION — returned books report: counter receipts incl. renewals/late returns. */
  async returned(
    from?: string,
    to?: string,
    departmentId?: number,
  ): Promise<ReportTable> {
    const where: Prisma.book_borrow_recordsWhereInput = { status: 'returned' };
    if (from || to) {
      where.returned_date = {};
      if (from) where.returned_date.gte = new Date(from);
      if (to) where.returned_date.lte = new Date(to);
    }

    let records = await this.prisma.book_borrow_records.findMany({
      where,
      include: BORROW_RECORD_REPORT_INCLUDE,
      orderBy: { returned_date: 'desc' },
    });

    if (departmentId) {
      records = records.filter(
        (r) => borrowerDepartment(r).id === departmentId,
      );
    }

    return {
      title: 'Returned books report',
      columns: [
        { header: 'Accession', key: 'accession', width: 16 },
        { header: 'Title', key: 'title', width: 28 },
        { header: 'Borrower', key: 'borrower', width: 22 },
        { header: 'Department', key: 'department', width: 18 },
        { header: 'Returned', key: 'returned_date', width: 14 },
        { header: 'Renewals', key: 'renewal_count', width: 10 },
        { header: 'Late?', key: 'late', width: 8 },
        { header: 'Fine paid', key: 'fine_paid', width: 10 },
      ],
      rows: records.map((r) => ({
        accession: r.books.qr_code,
        title: r.books.title,
        borrower: borrowerName(r),
        department: borrowerDepartment(r).name,
        returned_date: r.returned_date
          ? r.returned_date.toISOString().slice(0, 10)
          : '',
        renewal_count: r.renewal_count,
        late: r.returned_date && r.returned_date > r.due_date ? 'Yes' : 'No',
        fine_paid: r.fine_paid ? 'Yes' : 'No',
      })),
    };
  }

  /** 4. CIRCULATION — overdue books report: grouped by days-late and department. */
  async overdue(departmentId?: number): Promise<ReportTable> {
    const now = new Date();
    let records = await this.prisma.book_borrow_records.findMany({
      where: { status: 'borrowed', due_date: { lt: now } },
      include: BORROW_RECORD_REPORT_INCLUDE,
      orderBy: { due_date: 'asc' },
    });

    if (departmentId) {
      records = records.filter(
        (r) => borrowerDepartment(r).id === departmentId,
      );
    }

    return {
      title: 'Overdue books report',
      columns: [
        { header: 'Accession', key: 'accession', width: 16 },
        { header: 'Title', key: 'title', width: 28 },
        { header: 'Borrower', key: 'borrower', width: 22 },
        { header: 'Department', key: 'department', width: 18 },
        { header: 'Due', key: 'due_date', width: 14 },
        { header: 'Days overdue', key: 'days_overdue', width: 12 },
      ],
      rows: records.map((r) => ({
        accession: r.books.qr_code,
        title: r.books.title,
        borrower: borrowerName(r),
        department: borrowerDepartment(r).name,
        due_date: r.due_date.toISOString().slice(0, 10),
        days_overdue: Math.round(
          (now.getTime() - r.due_date.getTime()) / 86_400_000,
        ),
      })),
    };
  }

  /**
   * 5. MEMBERS — no-dues clearance list: members with books/fines still
   * pending. The design frames this as "final-year members" specifically;
   * this codebase has no reliable "is final year" derivation available
   * without a current-academic-year config that doesn't exist yet, so this
   * lists every student with outstanding library dues instead of filtering
   * to final-year only — a deliberate scope simplification, not an oversight.
   */
  async noDuesClearanceList(): Promise<ReportTable> {
    const now = new Date();
    const records = await this.prisma.book_borrow_records.findMany({
      where: {
        borrower_type: 'student',
        OR: [
          { status: 'borrowed', due_date: { lt: now } },
          {
            status: 'returned',
            fine_paid: false,
            returned_date: { not: null },
          },
          { status: { in: ['lost', 'damaged'] }, damage_lost_settled: false },
        ],
      },
      include: BORROW_RECORD_REPORT_INCLUDE,
      orderBy: { due_date: 'asc' },
    });

    // Only keep genuinely-late returns (returned_date > due_date), since the
    // OR above can't express that comparison between two columns.
    const pending = records.filter(
      (r) =>
        r.status !== 'returned' ||
        (r.returned_date !== null && r.returned_date > r.due_date),
    );

    return {
      title: 'No-dues clearance list',
      columns: [
        { header: 'Student', key: 'borrower', width: 22 },
        { header: 'Department', key: 'department', width: 18 },
        { header: 'Title', key: 'title', width: 28 },
        { header: 'Issue', key: 'issue', width: 16 },
      ],
      rows: pending.map((r) => ({
        borrower: borrowerName(r),
        department: borrowerDepartment(r).name,
        title: r.books.title,
        issue:
          r.status === 'borrowed'
            ? 'Overdue book'
            : r.status === 'returned'
              ? 'Unpaid late fine'
              : `${r.status} — charge unsettled`,
      })),
    };
  }

  /**
   * 6. STOCK — accession register: statutory register of every copy added,
   * with fund and vendor. `books` rows are a title-level aggregate (one row
   * per title/edition, total_copies counts physical copies) rather than one
   * row per individually-accessioned physical copy, and there's no
   * created_at on `books` — so this is the closest available approximation
   * (per-title, not per-physical-copy, and unordered by acquisition date),
   * not a true statutory accession register. A real one needs a schema
   * change (a books_copies-style child table) that's out of this scope.
   */
  async accessionRegister(departmentId?: number): Promise<ReportTable> {
    const books = await this.prisma.books.findMany({
      where: departmentId ? { department_id: departmentId } : {},
      include: {
        departments: { select: { name: true } },
      },
      orderBy: { qr_code: 'asc' },
    });

    return {
      title: 'Accession register',
      columns: [
        { header: 'Accession', key: 'accession', width: 16 },
        { header: 'Title', key: 'title', width: 30 },
        { header: 'Department', key: 'department', width: 18 },
        { header: 'Copies', key: 'total_copies', width: 10 },
        { header: 'Price/copy', key: 'price_per_copy', width: 12 },
        { header: 'Vendor / fund', key: 'vendor_fund', width: 24 },
      ],
      rows: books.map((b) => ({
        accession: b.qr_code,
        title: b.title,
        department: b.departments?.name ?? '',
        total_copies: b.total_copies,
        price_per_copy:
          b.price_per_copy !== null ? Number(b.price_per_copy) : '',
        vendor_fund: b.vendor_fund ?? '',
      })),
    };
  }
}
