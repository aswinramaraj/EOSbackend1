import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { FeedbackService } from 'src/modules/feedback/feedback/feedback.service';
import { feedback_form_type_enum } from '../../../generated/prisma/client';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

/**
 * HoD's read-only view of "Faculty Feedback" - the existing end_semester
 * feedback_forms mechanism (students rate their own subject-handling
 * faculty, one form per class, authored by the Academic Coordinator - see
 * FeedbackService's own doc comment). Nothing new is created here; this
 * just scopes the ALREADY-BUILT FeedbackService.getResults() aggregation
 * to forms whose class belongs to the caller's own department, the same
 * resolveDepartmentId pattern every other hod-*.service.ts uses.
 */
@Injectable()
export class HodFacultyFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feedbackService: FeedbackService,
  ) {}

  private async resolveDepartmentId(user: JwtPayload): Promise<number> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty.department_id;
  }

  /** GET /hod/faculty-feedback/forms - every end_semester form for a class in this HoD's own department. */
  async listForms(user: JwtPayload) {
    const departmentId = await this.resolveDepartmentId(user);
    const forms = await this.prisma.feedback_forms.findMany({
      where: {
        form_type: feedback_form_type_enum.end_semester,
        classes: { department_id: departmentId },
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        title: true,
        is_published: true,
        created_at: true,
        classes: {
          select: {
            section: true,
            current_semester: true,
            batches: { select: { name: true } },
          },
        },
        _count: { select: { feedback_questions: true } },
      },
    });

    return forms.map((f) => ({
      id: f.id,
      title: f.title,
      is_published: f.is_published,
      created_at: f.created_at,
      question_count: f._count.feedback_questions,
      class_label: f.classes
        ? `${f.classes.batches.name} · Sem ${f.classes.current_semester ?? '—'} · Section ${f.classes.section}`
        : '—',
    }));
  }

  /** GET /hod/faculty-feedback/forms/:id/results - department ownership re-checked server-side, never trusted from the client. */
  async getResults(user: JwtPayload, formId: number) {
    const departmentId = await this.resolveDepartmentId(user);
    const form = await this.prisma.feedback_forms.findUnique({
      where: { id: formId },
      select: { form_type: true, classes: { select: { department_id: true } } },
    });
    if (
      !form ||
      form.form_type !== feedback_form_type_enum.end_semester ||
      form.classes?.department_id !== departmentId
    ) {
      throw new ForbiddenException({
        message: 'This feedback form is outside your department.',
        errorCode: 'DEPARTMENT_OUTSIDE_SCOPE',
      });
    }
    return this.feedbackService.getResults(formId);
  }
}
