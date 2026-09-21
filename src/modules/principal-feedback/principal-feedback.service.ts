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
