import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { feedback_question_type_enum } from '../../../../generated/prisma/enums';
import { CreateFacultyFeedbackFormDto } from './dto/create-faculty-feedback-form.dto';
import { SubmitFacultyFeedbackDto } from './dto/submit-faculty-feedback.dto';

/**
 * HoD -> Faculty feedback (tables from prisma/manual-sql/faculty_feedback.sql).
 * A HoD posts a form to every faculty member of their own department; each
 * faculty member answers it once from their Campus tab. Results are
 * aggregated and anonymous (no faculty identity reported), same convention
 * as student feedback (FeedbackService.getResults). The form's creator is
 * never asked to answer their own form.
 */
@Injectable()
export class FacultyFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveFaculty(user: JwtPayload) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { id: true, department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty;
  }

  /** Active faculty in the department, minus the form's own creator. */
  private targetFacultyCount(departmentId: number, creatorUserId: number) {
    return this.prisma.faculty.count({
      where: {
        department_id: departmentId,
        status: 'active',
        user_id: { not: creatorUserId },
      },
    });
  }

  private async respondentCount(formId: number) {
    const rows = await this.prisma.faculty_feedback_responses.findMany({
      where: { faculty_feedback_questions: { form_id: formId } },
      select: { faculty_id: true },
      distinct: ['faculty_id'],
    });
    return rows.length;
  }

  // ───────────────────────────── HoD ─────────────────────────────

  /** GET /hod/faculty-feedback-forms - every form posted to this HoD's department. */
  async listForHod(user: JwtPayload) {
    const { department_id } = await this.resolveFaculty(user);
    const forms = await this.prisma.faculty_feedback_forms.findMany({
      where: { department_id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        title: true,
        is_published: true,
        created_at: true,
        created_by_user_id: true,
        _count: { select: { faculty_feedback_questions: true } },
      },
    });

    const result: {
      id: number;
      title: string;
      is_published: boolean;
      created_at: Date;
      created_by_me: boolean;
      question_count: number;
      target_faculty_count: number;
      respondent_count: number;
    }[] = [];
    // Sequential - small shared Supabase pool (see HodService's comments).
    for (const f of forms) {
      result.push({
        id: f.id,
        title: f.title,
        is_published: f.is_published,
        created_at: f.created_at,
        created_by_me: f.created_by_user_id === user.sub,
        question_count: f._count.faculty_feedback_questions,
        target_faculty_count: await this.targetFacultyCount(
          department_id,
          f.created_by_user_id,
        ),
        respondent_count: await this.respondentCount(f.id),
      });
    }
    return result;
  }

  /** POST /hod/faculty-feedback-forms - published immediately. */
  async createForHod(user: JwtPayload, dto: CreateFacultyFeedbackFormDto) {
    const { department_id } = await this.resolveFaculty(user);
    return this.prisma.faculty_feedback_forms.create({
      data: {
        title: dto.title,
        department_id,
        created_by_user_id: user.sub,
        faculty_feedback_questions: {
          create: dto.questions.map((q, idx) => ({
            question_text: q.question_text,
            sequence_no: q.sequence_no ?? idx + 1,
            question_type: q.question_type,
          })),
        },
      },
      include: {
        faculty_feedback_questions: { orderBy: { sequence_no: 'asc' } },
      },
    });
  }

  private async findDepartmentFormOrThrow(
    formId: number,
    departmentId: number,
  ) {
    const form = await this.prisma.faculty_feedback_forms.findUnique({
      where: { id: formId },
      include: {
        faculty_feedback_questions: {
          orderBy: { sequence_no: 'asc' },
          include: {
            faculty_feedback_responses: {
              select: { rating_value: true, response_text: true },
            },
          },
        },
      },
    });
    if (!form || form.department_id !== departmentId) {
      throw new ForbiddenException({
        message: 'This feedback form is outside your department.',
        errorCode: 'DEPARTMENT_OUTSIDE_SCOPE',
      });
    }
    return form;
  }

  /** GET /hod/faculty-feedback-forms/:id/results - anonymous aggregate per question. */
  async resultsForHod(user: JwtPayload, formId: number) {
    const { department_id } = await this.resolveFaculty(user);
    const form = await this.findDepartmentFormOrThrow(formId, department_id);

    return {
      form_id: form.id,
      title: form.title,
      form_type: 'general' as const,
      target_student_count: await this.targetFacultyCount(
        department_id,
        form.created_by_user_id,
      ),
      respondent_count: await this.respondentCount(form.id),
      questions: form.faculty_feedback_questions.map((q) => {
        const responses = q.faculty_feedback_responses;
        const base = {
          id: q.id,
          question_text: q.question_text,
          sequence_no: q.sequence_no,
          question_type: q.question_type,
          response_count: responses.length,
        };
        if (q.question_type === feedback_question_type_enum.rating) {
          const ratings = responses
            .map((r) => r.rating_value)
            .filter((v): v is number => v !== null);
          return {
            ...base,
            average_rating: ratings.length
              ? Math.round(
                  (ratings.reduce((sum, v) => sum + v, 0) / ratings.length) *
                    100,
                ) / 100
              : null,
            rating_distribution: Object.fromEntries(
              [1, 2, 3, 4, 5].map((v) => [
                v,
                ratings.filter((r) => r === v).length,
              ]),
            ),
          };
        }
        return { ...base, responses: responses.map((r) => r.response_text) };
      }),
    };
  }

  /** DELETE /hod/faculty-feedback-forms/:id - creator only, before anyone responds. */
  async deleteForHod(user: JwtPayload, formId: number) {
    const { department_id } = await this.resolveFaculty(user);
    const form = await this.findDepartmentFormOrThrow(formId, department_id);
    if (form.created_by_user_id !== user.sub) {
      throw new ForbiddenException(
        'Only the HoD who posted this form can delete it',
      );
    }
    if ((await this.respondentCount(formId)) > 0) {
      throw new ConflictException(
        'Cannot delete a form that already has faculty responses',
      );
    }
    await this.prisma.faculty_feedback_forms.delete({ where: { id: formId } });
    return { id: formId };
  }

  // ───────────────────────────── Faculty ─────────────────────────────

  /** GET /me/faculty-feedback/forms - published forms from my department's HoD, not my own. */
  async listForFaculty(user: JwtPayload) {
    const faculty = await this.resolveFaculty(user);
    const forms = await this.prisma.faculty_feedback_forms.findMany({
      where: {
        department_id: faculty.department_id,
        is_published: true,
        created_by_user_id: { not: user.sub },
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        title: true,
        created_at: true,
        users: {
          select: {
            email: true,
            roles: { select: { name: true } },
            faculty: { select: { first_name: true, last_name: true } },
          },
        },
        _count: { select: { faculty_feedback_questions: true } },
      },
    });

    const result: {
      id: number;
      title: string;
      created_at: Date;
      posted_by_name: string;
      posted_by_role: string;
      question_count: number;
      completed: boolean;
    }[] = [];
    for (const f of forms) {
      const answered = await this.prisma.faculty_feedback_responses.count({
        where: {
          faculty_id: faculty.id,
          faculty_feedback_questions: { form_id: f.id },
        },
      });
      result.push({
        id: f.id,
        title: f.title,
        created_at: f.created_at,
        posted_by_name: f.users.faculty
          ? `${f.users.faculty.first_name} ${f.users.faculty.last_name}`
          : f.users.email,
        posted_by_role: f.users.roles.name,
        question_count: f._count.faculty_feedback_questions,
        completed: answered > 0,
      });
    }
    return result;
  }

  private async findFacultyFormOrThrow(formId: number, departmentId: number) {
    const form = await this.prisma.faculty_feedback_forms.findUnique({
      where: { id: formId },
      include: {
        faculty_feedback_questions: { orderBy: { sequence_no: 'asc' } },
      },
    });
    if (!form || form.department_id !== departmentId || !form.is_published) {
      throw new NotFoundException({
        message: 'Feedback form not found',
        errorCode: 'FACULTY_FEEDBACK_FORM_NOT_FOUND',
      });
    }
    return form;
  }

  /** GET /me/faculty-feedback/forms/:id - questions plus my own answers, if already submitted. */
  async getForFaculty(user: JwtPayload, formId: number) {
    const faculty = await this.resolveFaculty(user);
    const form = await this.findFacultyFormOrThrow(
      formId,
      faculty.department_id,
    );
    const mine = await this.prisma.faculty_feedback_responses.findMany({
      where: {
        faculty_id: faculty.id,
        faculty_feedback_questions: { form_id: formId },
      },
      select: { question_id: true, rating_value: true, response_text: true },
    });
    const byQuestion = new Map(mine.map((m) => [m.question_id, m]));

    return {
      id: form.id,
      title: form.title,
      completed: mine.length > 0,
      questions: form.faculty_feedback_questions.map((q) => ({
        id: q.id,
        question_text: q.question_text,
        sequence_no: q.sequence_no,
        question_type: q.question_type,
        rating_value: byQuestion.get(q.id)?.rating_value ?? null,
        response_text: byQuestion.get(q.id)?.response_text ?? null,
      })),
    };
  }

  /** POST /me/faculty-feedback/forms/:id/responses - all questions, once. */
  async submitForFaculty(
    user: JwtPayload,
    formId: number,
    dto: SubmitFacultyFeedbackDto,
  ) {
    const faculty = await this.resolveFaculty(user);
    const form = await this.findFacultyFormOrThrow(
      formId,
      faculty.department_id,
    );
    if (form.created_by_user_id === user.sub) {
      throw new ForbiddenException('You cannot answer your own feedback form');
    }

    const already = await this.prisma.faculty_feedback_responses.count({
      where: {
        faculty_id: faculty.id,
        faculty_feedback_questions: { form_id: formId },
      },
    });
    if (already > 0) {
      throw new ConflictException('You have already submitted this feedback');
    }

    const answers = new Map(dto.responses.map((r) => [r.question_id, r]));
    const rows = form.faculty_feedback_questions.map((q) => {
      const a = answers.get(q.id);
      if (q.question_type === feedback_question_type_enum.rating) {
        if (!a?.rating_value) {
          throw new BadRequestException(`Please rate: "${q.question_text}"`);
        }
        return {
          question_id: q.id,
          faculty_id: faculty.id,
          rating_value: a.rating_value,
          response_text: null,
        };
      }
      const text = a?.response_text?.trim();
      if (!text) {
        throw new BadRequestException(`Please answer: "${q.question_text}"`);
      }
      return {
        question_id: q.id,
        faculty_id: faculty.id,
        rating_value: null,
        response_text: text,
      };
    });

    await this.prisma.faculty_feedback_responses.createMany({ data: rows });
    return { form_id: formId, submitted: rows.length };
  }
}
