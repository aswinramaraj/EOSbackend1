import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

interface FormRow {
  id: number;
  title: string;
  form_type: string;
  category: string | null;
  is_published: boolean;
  created_at: Date;
  class_section: string | null;
  batch_name: string | null;
  target_student_count: bigint;
  respondent_count: bigint;
  average_rating: string | null;
}

export const FEEDBACK_TYPES = ['academic', 'service', 'mess', 'parent'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

const TYPE_LABELS: Record<FeedbackType, string> = {
  academic: 'Academic',
  service: 'Campus services',
  mess: 'Hostel mess',
  parent: 'Parent',
};

const SUB_TYPE_LABELS: Record<string, string> = {
  general: 'General forms',
  end_semester: 'Faculty feedback',
  food_court: 'Food Court',
  medical: 'Medical',
  library: 'Library',
  stationary: 'Stationery',
  copy_center: 'Copy Center',
  mess: 'Mess',
  about_student: 'About their child',
  about_college: 'About the college',
};

interface GroupRow {
  key: string | null;
  label: string | null;
  submissions: bigint;
  rating_count: bigint;
  average_rating: string | null;
}

interface CommentRow {
  type: FeedbackType;
  sub_type: string | null;
  comment: string;
  rating: number | null;
  created_at: Date;
  department_name: string | null;
}

interface RatingAgg {
  _sum: { rating_value: number | null };
  _count: { rating_value: number };
}

/**
 * Correspondent/Principal institution-wide Feedback overview — rolls up
 * every feedback_forms row (both `general` and `end_semester` matrix forms
 * from the Academic Coordinator's feedback module) into a single read-only
 * dashboard. Per-form target/respondent counts reuse the exact "which
 * students does this form target" logic FeedbackService.getResults already
 * trusts (class_id -> that class's roster, else batch_id -> that batch's
 * roster, else the whole institution) — there is no separate "expected
 * respondents" table to read from instead. feedback_assignments is a dead
 * table (see FeedbackService.listQuestionTemplates' comment) and is not used.
 */
@Injectable()
export class PrincipalFeedbackService {
  private readonly logger = new Logger(PrincipalFeedbackService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every feedback source as one row per answer: type, sub_type, rating,
   * comment, date, department and a submission_key (one per person per
   * form/submission, so an academic form with 10 questions counts as one
   * submission, same as one mess review). Department comes from the form's
   * own class when it has one, else the student's class (service/mess
   * reviews and parent feedback about a child); rows with neither stay
   * department-less and only show under "All departments".
   */
  private feedbackItemsCte() {
    return Prisma.sql`
      WITH items AS (
        SELECT 'academic'::text AS type, ff.form_type::text AS sub_type,
               fr.rating_value::int AS rating, fr.response_text AS comment, fr.submitted_at AS created_at,
               COALESCE(fc.department_id, sc.department_id) AS department_id,
               'g' || ff.id || '-' || fr.student_id AS submission_key
        FROM feedback_responses fr
        JOIN feedback_questions fq ON fq.id = fr.question_id
        JOIN feedback_forms ff ON ff.id = fq.form_id
        LEFT JOIN classes fc ON fc.id = ff.class_id
        LEFT JOIN students s ON s.id = fr.student_id
        LEFT JOIN classes sc ON sc.id = s.class_id
        WHERE ff.service_type IS NULL
        UNION ALL
        SELECT 'academic', ff.form_type::text,
               ffr.rating_value::int, ffr.response_text, ffr.submitted_at,
               COALESCE(fc.department_id, sc.department_id),
               'm' || ff.id || '-' || ffr.student_id
        FROM feedback_faculty_responses ffr
        JOIN feedback_questions fq ON fq.id = ffr.question_id
        JOIN feedback_forms ff ON ff.id = fq.form_id
        LEFT JOIN classes fc ON fc.id = ff.class_id
        LEFT JOIN students s ON s.id = ffr.student_id
        LEFT JOIN classes sc ON sc.id = s.class_id
        UNION ALL
        SELECT 'service', ff.service_type::text,
               fr.rating_value::int, fr.response_text, fr.submitted_at,
               sc.department_id,
               's' || ff.id || '-' || fr.student_id
        FROM feedback_responses fr
        JOIN feedback_questions fq ON fq.id = fr.question_id
        JOIN feedback_forms ff ON ff.id = fq.form_id
        LEFT JOIN students s ON s.id = fr.student_id
        LEFT JOIN classes sc ON sc.id = s.class_id
        WHERE ff.service_type IS NOT NULL
        UNION ALL
        SELECT 'mess', 'mess',
               hmf.rating::int, hmf.comment, hmf.created_at,
               sc.department_id,
               'h' || hmf.id
        FROM hostel_mess_feedback hmf
        LEFT JOIN students s ON s.id = hmf.student_id
        LEFT JOIN classes sc ON sc.id = s.class_id
        UNION ALL
        SELECT 'parent', pf.category::text,
               pf.rating::int, pf.message, pf.created_at,
               sc.department_id,
               'p' || pf.id
        FROM parent_feedback pf
        LEFT JOIN students s ON s.id = pf.student_id
        LEFT JOIN classes sc ON sc.id = s.class_id
      )
    `;
  }

  private toGroup(row: GroupRow) {
    const ratingCount = Number(row.rating_count);
    return {
      submissions: Number(row.submissions),
      rating_count: ratingCount,
      average_rating:
        row.average_rating !== null && ratingCount > 0 ? Math.round(Number(row.average_rating) * 100) / 100 : null,
    };
  }

  /** GET /principal-feedback/insights - see the controller's doc comment. */
  async getInsights(filters: { type?: FeedbackType; departmentId?: number }) {
    try {
      const conditions: Prisma.Sql[] = [];
      if (filters.type) conditions.push(Prisma.sql`type = ${filters.type}`);
      if (filters.departmentId) conditions.push(Prisma.sql`department_id = ${filters.departmentId}`);
      const whereWith = (extra: Prisma.Sql[] = []) => {
        const all = [...conditions, ...extra];
        return all.length > 0 ? Prisma.sql`WHERE ${Prisma.join(all, ' AND ')}` : Prisma.empty;
      };
      const where = whereWith();
      // "By type" always spans every type (department filter only) so the
      // overall comparison stays visible even while one type is selected.
      const deptOnlyWhere = filters.departmentId
        ? Prisma.sql`WHERE department_id = ${filters.departmentId}`
        : Prisma.empty;
      const cte = this.feedbackItemsCte();
      const aggregate = Prisma.sql`
        COUNT(DISTINCT submission_key)::bigint AS submissions,
        COUNT(rating)::bigint AS rating_count,
        AVG(rating) AS average_rating
      `;

      // Sequential, not Promise.all - small shared Supabase pool (see getOverview).
      const [summary] = await this.prisma.$queryRaw<GroupRow[]>(Prisma.sql`
        ${cte} SELECT NULL AS key, NULL AS label, ${aggregate} FROM items ${where}
      `);
      const byType = await this.prisma.$queryRaw<GroupRow[]>(Prisma.sql`
        ${cte} SELECT type AS key, NULL AS label, ${aggregate} FROM items ${deptOnlyWhere} GROUP BY type
      `);
      const byDepartment = await this.prisma.$queryRaw<GroupRow[]>(Prisma.sql`
        ${cte} SELECT d.id::text AS key, d.name AS label, ${aggregate}
        FROM items JOIN departments d ON d.id = items.department_id
        ${where}
        GROUP BY d.id, d.name
      `);
      const bySubType = await this.prisma.$queryRaw<GroupRow[]>(Prisma.sql`
        ${cte} SELECT sub_type AS key, NULL AS label, ${aggregate} FROM items ${where} GROUP BY sub_type
      `);
      const distribution = await this.prisma.$queryRaw<{ rating: number; count: bigint }[]>(Prisma.sql`
        ${cte} SELECT rating, COUNT(*)::bigint AS count FROM items
        ${whereWith([Prisma.sql`rating BETWEEN 1 AND 5`])}
        GROUP BY rating
      `);
      const comments = await this.prisma.$queryRaw<CommentRow[]>(Prisma.sql`
        ${cte} SELECT items.type, items.sub_type, items.comment, items.rating, items.created_at, d.name AS department_name
        FROM items LEFT JOIN departments d ON d.id = items.department_id
        ${whereWith([Prisma.sql`NULLIF(TRIM(items.comment), '') IS NOT NULL`])}
        ORDER BY items.created_at DESC
        LIMIT 10
      `);
      const departments = await this.prisma.departments.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      const typeRows = new Map(byType.map((r) => [r.key, r]));
      const distributionMap = new Map(distribution.map((r) => [Number(r.rating), Number(r.count)]));

      return {
        filters: { type: filters.type ?? 'all', department_id: filters.departmentId ?? null },
        summary: this.toGroup(summary),
        // Every type always listed (zero rows included) so the chart's
        // categories never shift when a type has no data yet.
        by_type: FEEDBACK_TYPES.map((type) => {
          const row = typeRows.get(type);
          return {
            type,
            label: TYPE_LABELS[type],
            ...(row ? this.toGroup(row) : { submissions: 0, rating_count: 0, average_rating: null }),
          };
        }),
        by_department: byDepartment
          .map((r) => ({ department_id: Number(r.key), name: r.label ?? '—', ...this.toGroup(r) }))
          .sort((a, b) => b.submissions - a.submissions),
        by_sub_type: bySubType
          .map((r) => ({ key: r.key ?? 'other', label: SUB_TYPE_LABELS[r.key ?? ''] ?? r.key ?? 'Other', ...this.toGroup(r) }))
          .sort((a, b) => b.submissions - a.submissions),
        rating_distribution: [1, 2, 3, 4, 5].map((rating) => ({ rating, count: distributionMap.get(rating) ?? 0 })),
        recent_comments: comments.map((c) => ({
          type: c.type,
          type_label: TYPE_LABELS[c.type] ?? c.type,
          sub_type_label: c.sub_type ? (SUB_TYPE_LABELS[c.sub_type] ?? c.sub_type) : null,
          comment: c.comment,
          rating: c.rating,
          created_at: c.created_at,
          department_name: c.department_name,
        })),
        departments,
      };
    } catch (err) {
      this.logger.error('DB error computing principal feedback insights', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async getOverview(filters?: { departmentId?: number; batchId?: number }) {
    try {
      // Department narrows to forms scoped to a class within that
      // department (a form's own department attribution comes only through
      // its class - department is not a first-class scope on feedback_forms
      // itself). Batch matches either the form's own batch_id (batch-wide
      // forms) or its class's batch_id (class-scoped forms within that
      // batch). Institute-wide forms (no class_id/batch_id) are excluded
      // once either filter is active, since they carry no department/batch
      // attribution to filter on.
      const conditions: Prisma.Sql[] = [];
      if (filters?.departmentId) {
        conditions.push(Prisma.sql`c.department_id = ${filters.departmentId}`);
      }
      if (filters?.batchId) {
        conditions.push(Prisma.sql`(ff.batch_id = ${filters.batchId} OR c.batch_id = ${filters.batchId})`);
      }
      const whereClause = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

      // Sequential, not Promise.all - see principal-faculty/principal-departments
      // services for why (Supabase session-mode pool is small and shared).
      const formRows = await this.prisma.$queryRaw<FormRow[]>(Prisma.sql`
        SELECT
          ff.id,
          ff.title,
          ff.form_type::text AS form_type,
          ff.category::text AS category,
          ff.is_published,
          ff.created_at,
          c.section AS class_section,
          b.name AS batch_name,
          (
            CASE
              WHEN ff.class_id IS NOT NULL THEN (SELECT COUNT(*) FROM students s WHERE s.class_id = ff.class_id)
              WHEN ff.batch_id IS NOT NULL THEN (SELECT COUNT(*) FROM students s WHERE s.batch_id = ff.batch_id)
              ELSE (SELECT COUNT(*) FROM students)
            END
          )::bigint AS target_student_count,
          (
            CASE
              WHEN ff.form_type = 'end_semester' THEN (
                SELECT COUNT(DISTINCT fr.student_id) FROM feedback_faculty_responses fr
                JOIN feedback_questions fq ON fq.id = fr.question_id
                WHERE fq.form_id = ff.id
              )
              ELSE (
                SELECT COUNT(DISTINCT fr.student_id) FROM feedback_responses fr
                JOIN feedback_questions fq ON fq.id = fr.question_id
                WHERE fq.form_id = ff.id
              )
            END
          )::bigint AS respondent_count,
          (
            CASE
              WHEN ff.form_type = 'end_semester' THEN (
                SELECT AVG(fr.rating_value) FROM feedback_faculty_responses fr
                JOIN feedback_questions fq ON fq.id = fr.question_id
                WHERE fq.form_id = ff.id AND fr.rating_value IS NOT NULL
              )
              ELSE (
                SELECT AVG(fr.rating_value) FROM feedback_responses fr
                JOIN feedback_questions fq ON fq.id = fr.question_id
                WHERE fq.form_id = ff.id AND fr.rating_value IS NOT NULL
              )
            END
          ) AS average_rating
        FROM feedback_forms ff
        LEFT JOIN classes c ON c.id = ff.class_id
        LEFT JOIN batches b ON b.id = ff.batch_id
        ${whereClause}
        ORDER BY ff.created_at DESC
      `);

      // When a filter is active, scope the response/rating totals to the
      // same filtered form set the recent-forms breakdown above uses -
      // otherwise these stat cards would silently stay institution-wide
      // while the list below them narrows, which would look broken.
      const hasFilter = conditions.length > 0;
      const generalFormIds = formRows.filter((f) => f.form_type !== 'end_semester').map((f) => f.id);
      const matrixFormIds = formRows.filter((f) => f.form_type === 'end_semester').map((f) => f.id);

      const generalResponseCount = hasFilter
        ? generalFormIds.length > 0
          ? await this.prisma.feedback_responses.count({
              where: { feedback_questions: { form_id: { in: generalFormIds } } },
            })
          : 0
        : await this.prisma.feedback_responses.count();
      const matrixResponseCount = hasFilter
        ? matrixFormIds.length > 0
          ? await this.prisma.feedback_faculty_responses.count({
              where: { feedback_questions: { form_id: { in: matrixFormIds } } },
            })
          : 0
        : await this.prisma.feedback_faculty_responses.count();

      const generalRatingAgg = (hasFilter
        ? generalFormIds.length > 0
          ? await this.prisma.feedback_responses.aggregate({
              where: { rating_value: { not: null }, feedback_questions: { form_id: { in: generalFormIds } } },
              _sum: { rating_value: true },
              _count: { rating_value: true },
            })
          : { _sum: { rating_value: 0 }, _count: { rating_value: 0 } }
        : await this.prisma.feedback_responses.aggregate({
            where: { rating_value: { not: null } },
            _sum: { rating_value: true },
            _count: { rating_value: true },
          })) as RatingAgg;
      const matrixRatingAgg = (hasFilter
        ? matrixFormIds.length > 0
          ? await this.prisma.feedback_faculty_responses.aggregate({
              where: { rating_value: { not: null }, feedback_questions: { form_id: { in: matrixFormIds } } },
              _sum: { rating_value: true },
              _count: { rating_value: true },
            })
          : { _sum: { rating_value: 0 }, _count: { rating_value: 0 } }
        : await this.prisma.feedback_faculty_responses.aggregate({
            where: { rating_value: { not: null } },
            _sum: { rating_value: true },
            _count: { rating_value: true },
          })) as RatingAgg;

      const ratingSum = (generalRatingAgg._sum.rating_value ?? 0) + (matrixRatingAgg._sum.rating_value ?? 0);
      const ratingCount = (generalRatingAgg._count.rating_value ?? 0) + (matrixRatingAgg._count.rating_value ?? 0);

      const publishedForms = formRows.filter((f) => f.is_published).length;

      // Summed per-form, not a unique institution-wide headcount - a student
      // targeted/responding to more than one form is counted once per form,
      // same as how each form's own response_rate_pct is independently real.
      const totalTarget = formRows.reduce((sum, f) => sum + Number(f.target_student_count), 0);
      const totalRespondents = formRows.reduce((sum, f) => sum + Number(f.respondent_count), 0);

      return {
        total_forms: formRows.length,
        published_forms: publishedForms,
        draft_forms: formRows.length - publishedForms,
        total_responses: generalResponseCount + matrixResponseCount,
        total_target_students: totalTarget,
        total_respondents: totalRespondents,
        overall_response_rate_pct:
          totalTarget > 0 ? Math.round((totalRespondents / totalTarget) * 1000) / 10 : null,
        overall_average_rating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 100) / 100 : null,
        recent_forms: formRows.slice(0, 10).map((f) => {
          const target = Number(f.target_student_count);
          const respondents = Number(f.respondent_count);
          return {
            id: f.id,
            title: f.title,
            form_type: f.form_type,
            category: f.category,
            is_published: f.is_published,
            created_at: f.created_at,
            class_section: f.class_section,
            batch_name: f.batch_name,
            target_student_count: target,
            respondent_count: respondents,
            response_rate_pct: target > 0 ? Math.round((respondents / target) * 1000) / 10 : null,
            average_rating: f.average_rating !== null ? Math.round(Number(f.average_rating) * 100) / 100 : null,
          };
        }),
      };
    } catch (err) {
      this.logger.error('DB error computing principal feedback overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
