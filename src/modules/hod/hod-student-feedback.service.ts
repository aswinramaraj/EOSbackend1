import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { FeedbackService } from 'src/modules/feedback/feedback/feedback.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateHodStudentFeedbackDto } from './dto/create-hod-student-feedback.dto';

/**
 * HoD-authored student feedback - the HoD creates a feedback form for one
 * class in their own department (about its faculty, or anything else).
 * Reuses the existing feedback_forms mechanism end to end (FeedbackService
 * create/publish/results/delete), so students already see and answer these
 * forms through their existing Feedback screen with no student-side change.
 * Every endpoint re-checks department ownership server-side, the same
 * resolveDepartmentId pattern every other hod-*.service.ts uses.
 */
@Injectable()
export class HodStudentFeedbackService {
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

  private async assertClassInDepartment(classId: number, departmentId: number) {
    const cls = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: { department_id: true },
    });
    if (!cls || cls.department_id !== departmentId) {
      throw new ForbiddenException({
        message: 'This class is outside your department.',
        errorCode: 'DEPARTMENT_OUTSIDE_SCOPE',
      });
    }
  }

  private async assertFormInDepartment(formId: number, departmentId: number) {
    const form = await this.prisma.feedback_forms.findUnique({
      where: { id: formId },
      select: { classes: { select: { department_id: true } } },
    });
    if (!form || form.classes?.department_id !== departmentId) {
      throw new ForbiddenException({
        message: 'This feedback form is outside your department.',
        errorCode: 'DEPARTMENT_OUTSIDE_SCOPE',
      });
    }
  }

  /** GET /hod/student-feedback/forms - every class-targeted form in this HoD's department (theirs and the Academic Coordinator's). */
  async listForms(user: JwtPayload) {
    const departmentId = await this.resolveDepartmentId(user);
    const forms = await this.prisma.feedback_forms.findMany({
      where: {
        service_type: null,
        classes: { department_id: departmentId },
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        title: true,
        form_type: true,
        is_published: true,
        created_at: true,
        created_by_user_id: true,
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
      form_type: f.form_type,
      is_published: f.is_published,
      created_at: f.created_at,
      created_by_me: f.created_by_user_id === user.sub,
      question_count: f._count.feedback_questions,
      class_label: f.classes
        ? `${f.classes.batches.name} · Sem ${f.classes.current_semester ?? '—'} · Section ${f.classes.section}`
        : '—',
    }));
  }

  /** POST /hod/student-feedback/forms - created and published in one step, so students are notified straight away. */
  async createForm(user: JwtPayload, dto: CreateHodStudentFeedbackDto) {
    const departmentId = await this.resolveDepartmentId(user);
    await this.assertClassInDepartment(dto.class_id, departmentId);

    const form = await this.feedbackService.createForm(user, {
      title: dto.title,
      class_id: dto.class_id,
      form_type: dto.form_type,
      questions: dto.questions,
    });
    await this.feedbackService.publishForm(user, form.id);
    return { ...form, is_published: true };
  }

  /** GET /hod/student-feedback/forms/:id/results */
  async getResults(user: JwtPayload, formId: number) {
    const departmentId = await this.resolveDepartmentId(user);
    await this.assertFormInDepartment(formId, departmentId);
    return this.feedbackService.getResults(formId);
  }

  /** DELETE /hod/student-feedback/forms/:id - only the HoD's own forms, and only before any student has responded (enforced by FeedbackService). */
  async deleteForm(user: JwtPayload, formId: number) {
    const departmentId = await this.resolveDepartmentId(user);
    await this.assertFormInDepartment(formId, departmentId);
    return this.feedbackService.deleteForm(user, formId);
  }
}
