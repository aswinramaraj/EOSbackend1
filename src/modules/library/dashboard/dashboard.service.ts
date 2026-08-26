import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

type BorrowerRow = {
  id: number;
  borrower_type: string;
  borrowed_date: Date;
  returned_date: Date | null;
  damage_lost_declared_at: Date | null;
  status: string;
  books: { title: string };
  students: {
    soa_applications: { first_name: string; last_name: string | null } | null;
    users: { email: string };
  } | null;
  faculty: { first_name: string; last_name: string } | null;
};

function borrowerName(row: BorrowerRow): string {
  if (row.borrower_type === 'student') {
    if (!row.students) return 'Unknown student';
    return row.students.soa_applications
      ? `${row.students.soa_applications.first_name} ${row.students.soa_applications.last_name ?? ''}`.trim()
      : row.students.users.email;
  }
  if (row.borrower_type === 'faculty') {
    return row.faculty
      ? `${row.faculty.first_name} ${row.faculty.last_name}`.trim()
      : 'Unknown faculty';
  }
  return 'Staff member';
}

interface RecentActivityEvent {
  id: string;
  type: 'borrowed' | 'returned' | 'lost' | 'damaged';
  person: string;
  book_title: string;
  date: Date;
}

const BORROWER_INCLUDE = {
  books: { select: { title: true } },
  students: {
    select: {
      soa_applications: { select: { first_name: true, last_name: true } },
      users: { select: { email: true } },
    },
  },
  faculty: { select: { first_name: true, last_name: true } },
} as const;

@Injectable()
export class LibraryDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregate counts + today's activity + department availability + a real
   * recent-activity feed for the librarian dashboard. No caching — plain
   * COUNT/SUM/groupBy queries, cheap enough at a college library's scale.
   * Sequential awaits, NOT a $transaction array and NOT Promise.all — the
   * shared Supabase session-mode pool caps at 15 connections total across
   * every developer's own backend instance, and a batched $transaction
   * holds one connection for its whole duration; with this many queries
   * that alone was enough to time out just acquiring the transaction under
   * normal pool pressure. Sequential calls only ever hold one connection
   * briefly, matching the pool-safety discipline used everywhere else in
   * this codebase.
   */
  async summary() {
    const now = new Date();
    const today = new Date(now.toISOString().slice(0, 10));

    const copyTotals = await this.prisma.books.aggregate({
      _sum: { total_copies: true, available_copies: true },
    });
    const totalEbooks = await this.prisma.e_resources.count();
    const activeBorrowings = await this.prisma.book_borrow_records.count({
      where: { status: 'borrowed' },
    });
    const overdueBooks = await this.prisma.book_borrow_records.count({
      where: { status: 'borrowed', due_date: { lt: now } },
    });
    const lostBooks = await this.prisma.book_borrow_records.count({
      where: { status: 'lost' },
    });
    const damagedBooks = await this.prisma.book_borrow_records.count({
      where: { status: 'damaged' },
    });
    const issuedToday = await this.prisma.book_borrow_records.count({
      where: { borrowed_date: today },
    });
    const dueToday = await this.prisma.book_borrow_records.count({
      where: { status: 'borrowed', due_date: today },
    });
    const returnedToday = await this.prisma.book_borrow_records.count({
      where: { returned_date: today },
    });
    const deptGroups = await this.prisma.books.groupBy({
      by: ['department_id'],
      _sum: { available_copies: true, total_copies: true },
      orderBy: { department_id: 'asc' },
    });
    const departments = await this.prisma.departments.findMany({
      select: { id: true, name: true, code: true },
    });
    const recentBorrowed = await this.prisma.book_borrow_records.findMany({
      orderBy: { borrowed_date: 'desc' },
      take: 6,
      select: {
        id: true,
        borrowed_date: true,
        borrower_type: true,
        ...BORROWER_INCLUDE,
      },
    });
    const recentReturned = await this.prisma.book_borrow_records.findMany({
      where: { returned_date: { not: null } },
      orderBy: { returned_date: 'desc' },
      take: 6,
      select: {
        id: true,
        returned_date: true,
        borrower_type: true,
        ...BORROWER_INCLUDE,
      },
    });
    const recentLostDamaged = await this.prisma.book_borrow_records.findMany({
      where: { damage_lost_declared_at: { not: null } },
      orderBy: { damage_lost_declared_at: 'desc' },
      take: 4,
      select: {
        id: true,
        status: true,
        damage_lost_declared_at: true,
        borrower_type: true,
        ...BORROWER_INCLUDE,
      },
    });

    const deptById = new Map(departments.map((d) => [d.id, d]));
    const department_availability = deptGroups
      .map((g) => {
        const dept = g.department_id ? deptById.get(g.department_id) : null;
        return {
          department: dept?.name ?? 'Unclassified',
          department_code: dept?.code ?? '—',
          available_copies: g._sum?.available_copies ?? 0,
          total_copies: g._sum?.total_copies ?? 0,
        };
      })
      .sort((a, b) => b.available_copies - a.available_copies);

    const borrowedEvents: RecentActivityEvent[] = recentBorrowed.map((r) => ({
      id: `borrow-${r.id}`,
      type: 'borrowed',
      person: borrowerName(r as unknown as BorrowerRow),
      book_title: r.books.title,
      date: r.borrowed_date,
    }));
    const returnedEvents: RecentActivityEvent[] = recentReturned.map((r) => ({
      id: `return-${r.id}`,
      type: 'returned',
      person: borrowerName(r as unknown as BorrowerRow),
      book_title: r.books.title,
      date: r.returned_date as Date,
    }));
    const lostDamagedEvents: RecentActivityEvent[] = recentLostDamaged.map(
      (r) => ({
        id: `ld-${r.id}`,
        type: r.status === 'lost' ? 'lost' : 'damaged',
        person: borrowerName(r as unknown as BorrowerRow),
        book_title: r.books.title,
        date: r.damage_lost_declared_at as Date,
      }),
    );

    const recent_activity = [
      ...borrowedEvents,
      ...returnedEvents,
      ...lostDamagedEvents,
    ]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 6)
      .map((e) => ({ ...e, date: e.date.toISOString() }));

    return {
      total_books: copyTotals._sum.total_copies ?? 0,
      available_books: copyTotals._sum.available_copies ?? 0,
      total_ebooks: totalEbooks,
      active_borrowings: activeBorrowings,
      overdue_books: overdueBooks,
      lost_books: lostBooks,
      damaged_books: damagedBooks,
      today: {
        issued: issuedToday,
        due: dueToday,
        returned: returnedToday,
      },
      department_availability,
      recent_activity,
    };
  }
}
