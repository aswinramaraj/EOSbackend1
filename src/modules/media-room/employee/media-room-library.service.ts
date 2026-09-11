import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const BORROW_SELECT = {
  id: true,
  borrowed_date: true,
  due_date: true,
  returned_date: true,
  status: true,
  renewal_count: true,
  fine_paid_amount: true,
  books: {
    select: { id: true, title: true, qr_code: true, author: true },
  },
} as const;

interface BorrowRow {
  id: number;
  borrowed_date: Date;
  due_date: Date;
  returned_date: Date | null;
  status: string;
  renewal_count: number;
  fine_paid_amount: { toString(): string } | null;
  books: {
    id: number;
    title: string;
    qr_code: string | null;
    author: string | null;
  };
}

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Midnight UTC today, so a due date is compared day-to-day. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * A staff member's own library record.
 *
 * Read-only by design: borrowing, renewing and returning all happen at the
 * library counter against the librarian's own screens, which already own those
 * operations. Exposing a second write path here would let a loan be renewed
 * without the counter's checks (outstanding fines, per-borrower limits).
 */
@Injectable()
export class MediaRoomLibraryService {
  private readonly logger = new Logger(MediaRoomLibraryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /media-room/employee/library */
  async overview(userId: number) {
    try {
      // A staff account is linked to loans either through its faculty record
      // or, for non-teaching staff, directly by user id — both are checked so
      // the tab works whichever kind of account is signed in.
      const [faculty, settings] = await Promise.all([
        this.prisma.faculty.findUnique({
          where: { user_id: userId },
          select: { id: true, staff_code: true },
        }),
        this.prisma.library_settings.findFirst({
          select: {
            max_renewals: true,
            fine_per_day: true,
            grace_period_days: true,
          },
        }),
      ]);

      const rows = await this.prisma.book_borrow_records.findMany({
        where: faculty
          ? { OR: [{ faculty_id: faculty.id }, { staff_user_id: userId }] }
          : { staff_user_id: userId },
        select: BORROW_SELECT,
        orderBy: [{ borrowed_date: 'desc' }, { id: 'desc' }],
        take: 200,
      });

      const finePerDay = Number(settings?.fine_per_day ?? 0);
      const grace = settings?.grace_period_days ?? 0;
      const today = startOfToday();

      const shaped = rows.map((row) => this.shape(row, finePerDay, grace, today));

      return {
        ready: true,
        card_no: faculty?.staff_code ?? null,
        max_renewals: settings?.max_renewals ?? 0,
        // "Borrowed" is what is still out; everything else is history, so a
        // returned book leaves the active list without disappearing entirely.
        borrowed: shaped.filter((r) => r.status === 'borrowed'),
        history: shaped.filter((r) => r.status !== 'borrowed'),
      };
    } catch (err) {
      this.logger.error('DB error loading staff library record', err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private shape(
    row: BorrowRow,
    finePerDay: number,
    graceDays: number,
    today: Date,
  ) {
    const due = new Date(
      Date.UTC(
        row.due_date.getUTCFullYear(),
        row.due_date.getUTCMonth(),
        row.due_date.getUTCDate(),
      ),
    );
    const graceEnd = new Date(due.getTime() + graceDays * 86_400_000);
    const stillOut = row.status === 'borrowed';
    const isOverdue = stillOut && today.getTime() > graceEnd.getTime();
    const daysOverdue = isOverdue
      ? Math.floor((today.getTime() - graceEnd.getTime()) / 86_400_000)
      : 0;

    return {
      id: row.id,
      book: {
        id: row.books.id,
        title: row.books.title,
        qr_code: row.books.qr_code ?? '',
        author: row.books.author,
      },
      borrowed_date: dateOnly(row.borrowed_date),
      due_date: dateOnly(row.due_date),
      returned_date: dateOnly(row.returned_date),
      status: row.status,
      renewal_count: row.renewal_count,
      is_overdue: isOverdue,
      // An open loan accrues against the configured daily rate; a closed one
      // reports what was actually collected rather than recomputing it.
      fine_amount: stillOut
        ? Math.round(daysOverdue * finePerDay * 100) / 100
        : Number(row.fine_paid_amount ?? 0),
    };
  }
}
