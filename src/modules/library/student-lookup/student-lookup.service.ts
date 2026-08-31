import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

// Same threshold/limit convention as books.service.ts's searchFuzzy.
const FUZZY_SIMILARITY_THRESHOLD = 0.2;

interface StudentFuzzySearchRow {
  id: number;
  student_id_no: string;
  roll_no: string | null;
  register_no: string | null;
  status: string;
  email: string;
  course_id: number;
  course_name: string;
  department_id: number;
  department_name: string;
  department_code: string;
  first_name: string | null;
  last_name: string | null;
  similarity: number;
}

@Injectable()
export class StudentLookupService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Typo-tolerant search over student_id_no/roll_no/register_no/name/email,
   * for staff (library desk, admin) to find a student to act on — mirrors
   * BooksService.searchFuzzy's pg_trgm pattern one-for-one.
   *
   * Tries a precise (exact/prefix/substring) pass first; only falls back to
   * fuzzy trigram scoring if that finds nothing. Skipping straight to fuzzy
   * scoring let an unrelated name (e.g. a faculty member's, typed into this
   * student box because no faculty search path existed) clear the 0.2
   * threshold on pure trigram noise and surface as a false "match" instead
   * of a clean empty result — the query still worked, it just had no real
   * quality floor once the precise fields legitimately found nothing.
   */
  async searchFuzzy(query: string, limit = 20) {
    const q = query.trim();
    const cappedLimit = Math.min(limit ?? 20, 20);

    const preciseRows = await this.prisma.$queryRaw<StudentFuzzySearchRow[]>`
      SELECT
        s.id,
        s.student_id_no,
        s.roll_no,
        s.register_no,
        s.status,
        u.email,
        c.id AS course_id,
        c.name AS course_name,
        d.id AS department_id,
        d.name AS department_name,
        d.code AS department_code,
        sa.first_name,
        sa.last_name,
        1 AS similarity
      FROM students s
      JOIN users u ON u.id = s.user_id
      JOIN courses c ON c.id = s.course_id
      JOIN departments d ON d.id = c.department_id
      LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
      WHERE
        s.student_id_no ILIKE ${q + '%'}
        OR s.roll_no ILIKE ${q + '%'}
        OR s.register_no ILIKE ${q + '%'}
        OR (COALESCE(sa.first_name, '') || ' ' || COALESCE(sa.last_name, '')) ILIKE ${'%' + q + '%'}
        OR u.email ILIKE ${q + '%'}
      ORDER BY s.student_id_no ASC
      LIMIT ${cappedLimit}
    `;

    const rows =
      preciseRows.length > 0
        ? preciseRows
        : await this.prisma.$queryRaw<StudentFuzzySearchRow[]>`
      SELECT
        s.id,
        s.student_id_no,
        s.roll_no,
        s.register_no,
        s.status,
        u.email,
        c.id AS course_id,
        c.name AS course_name,
        d.id AS department_id,
        d.name AS department_name,
        d.code AS department_code,
        sa.first_name,
        sa.last_name,
        GREATEST(
          similarity(s.student_id_no, ${q}),
          similarity(COALESCE(s.roll_no, ''), ${q}),
          similarity(COALESCE(s.register_no, ''), ${q}),
          word_similarity(${q}, COALESCE(sa.first_name, '') || ' ' || COALESCE(sa.last_name, '')),
          word_similarity(${q}, u.email)
        ) AS similarity
      FROM students s
      JOIN users u ON u.id = s.user_id
      JOIN courses c ON c.id = s.course_id
      JOIN departments d ON d.id = c.department_id
      LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
      WHERE
        similarity(s.student_id_no, ${q}) > ${FUZZY_SIMILARITY_THRESHOLD}
        OR similarity(COALESCE(s.roll_no, ''), ${q}) > ${FUZZY_SIMILARITY_THRESHOLD}
        OR similarity(COALESCE(s.register_no, ''), ${q}) > ${FUZZY_SIMILARITY_THRESHOLD}
        OR word_similarity(${q}, COALESCE(sa.first_name, '') || ' ' || COALESCE(sa.last_name, '')) > ${FUZZY_SIMILARITY_THRESHOLD}
        OR word_similarity(${q}, u.email) > ${FUZZY_SIMILARITY_THRESHOLD}
      ORDER BY similarity DESC
      LIMIT ${cappedLimit}
    `;

    return rows.map((row) => ({
      id: row.id,
      student_id_no: row.student_id_no,
      roll_no: row.roll_no,
      register_no: row.register_no,
      status: row.status,
      email: row.email,
      name: row.first_name
        ? row.last_name
          ? `${row.first_name} ${row.last_name}`
          : row.first_name
        : `Student ${row.student_id_no}`,
      course: { id: row.course_id, name: row.course_name },
      department: {
        id: row.department_id,
        name: row.department_name,
        code: row.department_code,
      },
      similarity: Number(row.similarity),
    }));
  }

  /**
   * GET /library/students/:id/no-dues-check — informational only, for a
   * human (HoD reviewing a library_due hall-ticket-clearance request,
   * library staff, admin) to cross-check against real borrow records.
   * Never auto-approves/rejects anything itself, matching this codebase's
   * "never auto-approve" rule for approval workflows.
   */
  async noDuesCheck(studentId: number) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });

    if (!student) {
      throw new NotFoundException('Student not found.');
    }

    const records = await this.prisma.book_borrow_records.findMany({
      where: { student_id: studentId },
      include: { books: { select: { title: true, qr_code: true } } },
    });

    const now = new Date();

    const overdueBooks = records.filter(
      (r) => r.status === 'borrowed' && r.due_date < now,
    );
    const unpaidFineRecords = records.filter(
      (r) =>
        r.status === 'returned' &&
        !r.fine_paid &&
        r.returned_date !== null &&
        r.returned_date > r.due_date,
    );
    const unsettledChargeRecords = records.filter(
      (r) =>
        (r.status === 'lost' || r.status === 'damaged') &&
        !r.damage_lost_settled,
    );

    return {
      student_id: studentId,
      has_outstanding_library_dues:
        overdueBooks.length > 0 ||
        unpaidFineRecords.length > 0 ||
        unsettledChargeRecords.length > 0,
      overdue_books: overdueBooks.map((r) => ({
        borrow_record_id: r.id,
        title: r.books.title,
        accession: r.books.qr_code,
        due_date: r.due_date,
      })),
      unpaid_fine_records: unpaidFineRecords.map((r) => ({
        borrow_record_id: r.id,
        title: r.books.title,
        accession: r.books.qr_code,
      })),
      unsettled_lost_damaged_charges: unsettledChargeRecords.map((r) => ({
        borrow_record_id: r.id,
        title: r.books.title,
        accession: r.books.qr_code,
        charge_amount:
          r.damage_lost_charge_amount !== null
            ? Number(r.damage_lost_charge_amount)
            : null,
      })),
    };
  }
}
