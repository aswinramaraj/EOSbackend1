import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { CreateLinkResourceDto } from './dto/create-link-resource.dto';
import { CreateFileResourceDto } from './dto/create-file-resource.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { GradeSubmissionDto } from './dto/grade-submission.dto';
import { CreateLessonSessionDto } from './dto/create-lesson-session.dto';
import { UpdateLessonSessionDto } from './dto/update-lesson-session.dto';

function resolveStudentName(student: {
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
}): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

@Injectable()
export class LmsService {
  private readonly logger = new Logger(LmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  // ============================================================
  // STUDENT
  // ============================================================

  /** GET /me/lms/subjects (Student) — every subject on the student's own class, current semester. */
  async getMySubjects(userId: number) {
    const student = await this.resolveStudentByUserId(userId);
    if (!student.class_id) return [];

    const klass = await this.prisma.classes.findUnique({
      where: { id: student.class_id },
      select: { current_semester: true },
    });

    const rows = await this.prisma.class_subjects.findMany({
      where: {
        class_id: student.class_id,
        semester: klass?.current_semester ?? undefined,
      },
      select: {
        subjects: { select: { id: true, name: true, subject_code: true } },
      },
      orderBy: { subjects: { name: 'asc' } },
    });

    return rows.map((row) => ({
      subject_id: row.subjects.id,
      subject_name: row.subjects.name,
      subject_code: row.subjects.subject_code,
    }));
  }

  /** GET /me/lms/subjects/:subjectId/folders (Student) — folders shared to the student's own class for this subject. */
  async getStudentFolders(subjectId: number, userId: number) {
    const student = await this.resolveStudentByUserId(userId);
    if (!student.class_id) return [];

    const folders = await this.prisma.lms_folders.findMany({
      where: {
        subject_id: subjectId,
        lms_folder_classes: { some: { class_id: student.class_id } },
      },
      select: {
        id: true,
        title: true,
        description: true,
        created_at: true,
        faculty: { select: { first_name: true, last_name: true } },
        _count: { select: { lms_resources: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return folders.map((f) => ({
      id: f.id,
      title: f.title,
      description: f.description,
      created_at: f.created_at,
      faculty_name: `${f.faculty.first_name} ${f.faculty.last_name}`,
      resource_count: f._count.lms_resources,
    }));
  }

  /**
   * GET /me/lms/folders/:folderId/resources — shared by both roles.
   * Student: only if the folder is shared to their own class.
   * Faculty/HoD: only their own folder.
   */
  async getFolderResources(folderId: number, user: { sub: number; role: string }) {
    const folder = await this.prisma.lms_folders.findUnique({
      where: { id: folderId },
      select: {
        faculty_id: true,
        lms_folder_classes: { select: { class_id: true } },
      },
    });
    if (!folder) {
      throw new NotFoundException({ message: 'Folder not found', errorCode: 'FOLDER_NOT_FOUND' });
    }

    if (this.isStudentRole(user.role)) {
      const student = await this.resolveStudentByUserId(user.sub);
      const hasAccess = folder.lms_folder_classes.some((c) => c.class_id === student.class_id);
      if (!hasAccess) {
        throw new ForbiddenException('This folder is not shared with your class');
      }
    } else {
      const faculty = await this.resolveFacultyByUserId(user.sub);
      if (folder.faculty_id !== faculty.id) {
        throw new ForbiddenException('You may only view your own folders');
      }
    }

    const resources = await this.prisma.lms_resources.findMany({
      where: { folder_id: folderId },
      orderBy: { created_at: 'desc' },
    });

    return resources.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      resource_type: r.resource_type,
      file_url: r.file_url,
      link_url: r.link_url,
      created_at: r.created_at,
    }));
  }

  /** GET /me/lms/subjects/:subjectId/tasks (Student) — tasks for the student's own class + this subject, with their own submission status. */
  async getStudentTasks(subjectId: number, userId: number) {
    const student = await this.resolveStudentByUserId(userId);
    if (!student.class_id) return [];

    const tasks = await this.prisma.assignments.findMany({
      where: { subject_id: subjectId, class_id: student.class_id },
      select: {
        id: true,
        title: true,
        description: true,
        due_date: true,
        max_marks: true,
        task_type: true,
        attachment_url: true,
        student_assignment_status: {
          where: { student_id: student.id },
          select: {
            is_submitted: true,
            submission_file_url: true,
            submitted_at: true,
            marks_obtained: true,
          },
        },
      },
      orderBy: { id: 'desc' },
    });

    return tasks.map((t) => {
      const status = t.student_assignment_status[0] ?? null;
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        due_date: t.due_date,
        max_marks: t.max_marks,
        task_type: t.task_type,
        attachment_url: t.attachment_url,
        is_submitted: status?.is_submitted ?? false,
        submission_file_url: status?.submission_file_url ?? null,
        submitted_at: status?.submitted_at ?? null,
        marks_obtained: status?.marks_obtained ?? null,
      };
    });
  }

  /** POST /me/lms/tasks/:taskId/submit (Student) — uploads a PDF and marks the task submitted (or re-submitted, if not yet graded). */
  async submitTask(taskId: number, userId: number, file: Express.Multer.File) {
    const student = await this.resolveStudentByUserId(userId);

    const task = await this.prisma.assignments.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException({ message: 'Task not found', errorCode: 'TASK_NOT_FOUND' });
    }
    if (task.class_id !== student.class_id) {
      throw new ForbiddenException('This task is not assigned to your class');
    }

    const existing = await this.prisma.student_assignment_status.findUnique({
      where: { assignment_id_student_id: { assignment_id: taskId, student_id: student.id } },
    });
    if (existing?.marks_obtained !== null && existing?.marks_obtained !== undefined) {
      throw new BadRequestException({
        message: 'This task has already been graded and can no longer be resubmitted',
        errorCode: 'ALREADY_GRADED',
      });
    }

    const { key } = await this.storage.upload('lms-submissions', file.originalname, file.buffer, file.mimetype);
    const submissionUrl = this.storage.getPublicUrl(key);

    await this.prisma.student_assignment_status.upsert({
      where: { assignment_id_student_id: { assignment_id: taskId, student_id: student.id } },
      create: {
        assignment_id: taskId,
        student_id: student.id,
        is_submitted: true,
        submission_file_url: submissionUrl,
        submitted_at: new Date(),
      },
      update: {
        is_submitted: true,
        submission_file_url: submissionUrl,
        submitted_at: new Date(),
      },
    });

    return { submission_file_url: submissionUrl };
  }

  /** GET /me/lms/subjects/:subjectId/lesson-plan (Student) — the lesson plan + sessions for the student's own class. */
  async getStudentLessonPlan(subjectId: number, userId: number) {
    const student = await this.resolveStudentByUserId(userId);
    if (!student.class_id) return { sessions: [] };
    return this.fetchLessonPlan(subjectId, student.class_id);
  }

  // ============================================================
  // FACULTY / HOD
  // ============================================================

  /** GET /me/lms/my-subjects (Faculty/HoD) — every subject the caller teaches, each with the classes they teach it to (for the folder/task class-picker). */
  async getMyTeachingSubjects(userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mappings = await this.prisma.faculty_subject_class_mapping.findMany({
      where: { faculty_id: faculty.id },
      select: {
        subject_id: true,
        subjects: { select: { name: true, subject_code: true } },
        class_id: true,
        classes: { select: { section: true, departments: { select: { code: true } } } },
      },
      orderBy: [{ subject_id: 'asc' }, { class_id: 'asc' }],
    });

    const bySubject = new Map<
      number,
      { subject_id: number; subject_name: string; subject_code: string; classes: { class_id: number; label: string }[] }
    >();
    for (const m of mappings) {
      const entry = bySubject.get(m.subject_id) ?? {
        subject_id: m.subject_id,
        subject_name: m.subjects.name,
        subject_code: m.subjects.subject_code,
        classes: [],
      };
      if (!entry.classes.some((c) => c.class_id === m.class_id)) {
        entry.classes.push({
          class_id: m.class_id,
          label: `${m.classes.departments.code} - ${m.classes.section}`,
        });
      }
      bySubject.set(m.subject_id, entry);
    }

    return Array.from(bySubject.values());
  }

  /** GET /me/lms/my-subjects/:subjectId/folders (Faculty/HoD) — the caller's own folders for this subject, with which classes each is shared to. */
  async getFacultyFolders(subjectId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const folders = await this.prisma.lms_folders.findMany({
      where: { subject_id: subjectId, faculty_id: faculty.id },
      select: {
        id: true,
        title: true,
        description: true,
        created_at: true,
        _count: { select: { lms_resources: true } },
        lms_folder_classes: {
          select: { class_id: true, classes: { select: { section: true, departments: { select: { code: true } } } } },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return folders.map((f) => ({
      id: f.id,
      title: f.title,
      description: f.description,
      created_at: f.created_at,
      resource_count: f._count.lms_resources,
      classes: f.lms_folder_classes.map((c) => ({
        class_id: c.class_id,
        label: `${c.classes.departments.code} - ${c.classes.section}`,
      })),
    }));
  }

  /** POST /me/lms/folders (Faculty/HoD) — verifies the caller actually teaches subject_id to every one of class_ids before creating. */
  async createFolder(dto: CreateFolderDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    await this.assertTeachesAllClasses(faculty.id, dto.subject_id, dto.class_ids);

    const folder = await this.prisma.lms_folders.create({
      data: {
        subject_id: dto.subject_id,
        faculty_id: faculty.id,
        title: dto.title,
        description: dto.description,
        lms_folder_classes: { createMany: { data: dto.class_ids.map((class_id) => ({ class_id })) } },
      },
    });

    this.logger.log(`LMS folder created: id=${folder.id} faculty=${faculty.id} subject=${dto.subject_id}`);
    return { id: folder.id };
  }

  /** PATCH /me/lms/folders/:id (Faculty/HoD, own folder). */
  async updateFolder(folderId: number, dto: UpdateFolderDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const folder = await this.getOwnedFolder(folderId, faculty.id);

    if (dto.class_ids) {
      await this.assertTeachesAllClasses(faculty.id, folder.subject_id, dto.class_ids);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.lms_folders.update({
        where: { id: folderId },
        data: { title: dto.title, description: dto.description },
      });
      if (dto.class_ids) {
        await tx.lms_folder_classes.deleteMany({ where: { folder_id: folderId } });
        await tx.lms_folder_classes.createMany({
          data: dto.class_ids.map((class_id) => ({ folder_id: folderId, class_id })),
        });
      }
    });

    return { id: folderId, updated: true };
  }

  /** DELETE /me/lms/folders/:id (Faculty/HoD, own folder). Cascades to lms_folder_classes and lms_resources. */
  async deleteFolder(folderId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    await this.getOwnedFolder(folderId, faculty.id);
    await this.prisma.lms_folders.delete({ where: { id: folderId } });
    return { id: folderId, deleted: true };
  }

  /** POST /me/lms/folders/:id/resources/file (Faculty/HoD, own folder). */
  async addFileResource(folderId: number, dto: CreateFileResourceDto, userId: number, file: Express.Multer.File) {
    const faculty = await this.resolveFacultyByUserId(userId);
    await this.getOwnedFolder(folderId, faculty.id);

    const { key } = await this.storage.upload('lms-resources', file.originalname, file.buffer, file.mimetype);
    const fileUrl = this.storage.getPublicUrl(key);

    const resource = await this.prisma.lms_resources.create({
      data: {
        folder_id: folderId,
        title: dto.title,
        description: dto.description,
        resource_type: 'file',
        file_url: fileUrl,
        uploaded_by_user_id: userId,
      },
    });

    return { id: resource.id, file_url: fileUrl };
  }

  /** POST /me/lms/folders/:id/resources/link (Faculty/HoD, own folder). */
  async addLinkResource(folderId: number, dto: CreateLinkResourceDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    await this.getOwnedFolder(folderId, faculty.id);

    const resource = await this.prisma.lms_resources.create({
      data: {
        folder_id: folderId,
        title: dto.title,
        description: dto.description,
        resource_type: 'link',
        link_url: dto.link_url,
        uploaded_by_user_id: userId,
      },
    });

    return { id: resource.id };
  }

  /** DELETE /me/lms/resources/:id (Faculty/HoD, own folder's resource). */
  async deleteResource(resourceId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const resource = await this.prisma.lms_resources.findUnique({
      where: { id: resourceId },
      select: { id: true, lms_folders: { select: { faculty_id: true } } },
    });
    if (!resource) {
      throw new NotFoundException({ message: 'Resource not found', errorCode: 'RESOURCE_NOT_FOUND' });
    }
    if (resource.lms_folders.faculty_id !== faculty.id) {
      throw new ForbiddenException('You may only delete resources from your own folders');
    }

    await this.prisma.lms_resources.delete({ where: { id: resourceId } });
    return { id: resourceId, deleted: true };
  }

  /** GET /me/lms/my-subjects/:subjectId/tasks?class_id= (Faculty/HoD, own tasks). */
  async getFacultyTasks(subjectId: number, classId: number | undefined, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const tasks = await this.prisma.assignments.findMany({
      where: { subject_id: subjectId, faculty_id: faculty.id, class_id: classId },
      select: {
        id: true,
        title: true,
        description: true,
        due_date: true,
        max_marks: true,
        task_type: true,
        classes: { select: { id: true, section: true, departments: { select: { code: true } } } },
        _count: { select: { student_assignment_status: { where: { is_submitted: true } } } },
      },
      orderBy: { id: 'desc' },
    });

    return tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      due_date: t.due_date,
      max_marks: t.max_marks,
      task_type: t.task_type,
      class_label: `${t.classes.departments.code} - ${t.classes.section}`,
      submitted_count: t._count.student_assignment_status,
    }));
  }

  /**
   * POST /me/lms/tasks (Faculty/HoD) — fans out into one `assignments` row
   * per class_id. academic_year is taken from the caller's own
   * faculty_subject_class_mapping for that (subject,class) pair - never
   * client-supplied - and sequence_no auto-increments per (class, subject,
   * academic_year, semester), mirroring AssignmentsService's uniqueness
   * constraint without asking the caller to track it themselves.
   */
  async createTask(dto: CreateTaskDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const created: number[] = [];
    for (const classId of dto.class_ids) {
      const mapping = await this.prisma.faculty_subject_class_mapping.findFirst({
        where: { faculty_id: faculty.id, subject_id: dto.subject_id, class_id: classId },
        orderBy: { academic_year: 'desc' },
      });
      if (!mapping) {
        throw new ForbiddenException(
          `You are not assigned to teach subject ${dto.subject_id} for class ${classId}`,
        );
      }

      const classSubject = await this.prisma.class_subjects.findFirst({
        where: { class_id: classId, subject_id: dto.subject_id },
      });
      const semester = classSubject?.semester ?? 1;

      const last = await this.prisma.assignments.findFirst({
        where: {
          class_id: classId,
          subject_id: dto.subject_id,
          academic_year: mapping.academic_year,
          semester,
        },
        orderBy: { sequence_no: 'desc' },
      });

      const task = await this.prisma.assignments.create({
        data: {
          class_id: classId,
          subject_id: dto.subject_id,
          faculty_id: faculty.id,
          academic_year: mapping.academic_year,
          semester,
          sequence_no: (last?.sequence_no ?? 0) + 1,
          title: dto.title,
          description: dto.description,
          due_date: dto.due_date ? new Date(dto.due_date) : undefined,
          max_marks: dto.max_marks,
          task_type: dto.task_type,
        },
      });
      created.push(task.id);

      const classStudents = await this.prisma.students.findMany({
        where: { class_id: classId },
        select: { user_id: true },
      });
      for (const s of classStudents) {
        await this.notifications.notify({
          user_id: s.user_id,
          title: 'New task assigned',
          message: `${dto.title} has been assigned${dto.due_date ? ` (due ${dto.due_date})` : ''}.`,
          type: 'lms_task_assigned',
          related_entity_type: 'lms_task',
          related_entity_id: task.id,
        });
      }
    }

    this.logger.log(`LMS task created: ids=${created.join(',')} faculty=${faculty.id}`);
    return { ids: created };
  }

  /** DELETE /me/lms/tasks/:id (Faculty/HoD, own task). Cascades to student_assignment_status. */
  async deleteTask(taskId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const task = await this.prisma.assignments.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException({ message: 'Task not found', errorCode: 'TASK_NOT_FOUND' });
    }
    if (task.faculty_id !== faculty.id) {
      throw new ForbiddenException('You may only delete your own tasks');
    }
    await this.prisma.assignments.delete({ where: { id: taskId } });
    return { id: taskId, deleted: true };
  }

  /** GET /me/lms/tasks/:id/submissions (Faculty/HoD, own task) — every student in the class, submitted or not. */
  async getTaskSubmissions(taskId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const task = await this.prisma.assignments.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException({ message: 'Task not found', errorCode: 'TASK_NOT_FOUND' });
    }
    if (task.faculty_id !== faculty.id) {
      throw new ForbiddenException('You may only view submissions for your own tasks');
    }

    const students = await this.prisma.students.findMany({
      where: { class_id: task.class_id },
      select: {
        id: true,
        student_id_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
        student_assignment_status: {
          where: { assignment_id: taskId },
          select: { id: true, is_submitted: true, submission_file_url: true, submitted_at: true, marks_obtained: true },
        },
      },
      orderBy: { student_id_no: 'asc' },
    });

    return students.map((s) => {
      const status = s.student_assignment_status[0] ?? null;
      return {
        student_id: s.id,
        student_id_no: s.student_id_no,
        name: resolveStudentName(s),
        status_id: status?.id ?? null,
        is_submitted: status?.is_submitted ?? false,
        submission_file_url: status?.submission_file_url ?? null,
        submitted_at: status?.submitted_at ?? null,
        marks_obtained: status?.marks_obtained ?? null,
      };
    });
  }

  /** PATCH /me/lms/submissions/:id (Faculty/HoD, own task's submission). */
  async gradeSubmission(statusId: number, dto: GradeSubmissionDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const status = await this.prisma.student_assignment_status.findUnique({
      where: { id: statusId },
      select: {
        id: true,
        assignments: { select: { faculty_id: true, max_marks: true, title: true } },
        students: { select: { user_id: true } },
      },
    });
    if (!status) {
      throw new NotFoundException({ message: 'Submission not found', errorCode: 'SUBMISSION_NOT_FOUND' });
    }
    if (status.assignments.faculty_id !== faculty.id) {
      throw new ForbiddenException('You may only grade submissions for your own tasks');
    }
    if (status.assignments.max_marks !== null && dto.marks_obtained > status.assignments.max_marks) {
      throw new BadRequestException({
        message: `marks_obtained cannot exceed max_marks (${status.assignments.max_marks})`,
        errorCode: 'MARKS_EXCEED_MAX',
      });
    }

    await this.prisma.student_assignment_status.update({
      where: { id: statusId },
      data: { marks_obtained: dto.marks_obtained, marked_by_faculty_id: faculty.id, marked_at: new Date() },
    });

    await this.notifications.notify({
      user_id: status.students.user_id,
      title: 'Task graded',
      message: `${status.assignments.title} was graded: ${dto.marks_obtained}${status.assignments.max_marks !== null ? `/${status.assignments.max_marks}` : ''}.`,
      type: 'lms_task_graded',
      related_entity_type: 'lms_task_submission',
      related_entity_id: statusId,
    });

    return { id: statusId, marks_obtained: dto.marks_obtained };
  }

  /** GET /me/lms/my-subjects/:subjectId/lesson-plan?class_id= (Faculty/HoD, own mapping). */
  async getFacultyLessonPlan(subjectId: number, classId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    await this.assertTeachesAllClasses(faculty.id, subjectId, [classId]);
    return this.fetchLessonPlan(subjectId, classId, faculty.id);
  }

  /** POST /me/lms/lesson-plan/sessions (Faculty/HoD) — upserts the parent lesson_plans row, then appends a session. */
  async createLessonSession(dto: CreateLessonSessionDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    await this.assertTeachesAllClasses(faculty.id, dto.subject_id, [dto.class_id]);

    const classSubject = await this.prisma.class_subjects.findFirst({
      where: { class_id: dto.class_id, subject_id: dto.subject_id },
    });
    const semester = classSubject?.semester ?? 1;

    const plan = await this.prisma.lesson_plans.upsert({
      where: {
        faculty_id_subject_id_class_id_semester: {
          faculty_id: faculty.id,
          subject_id: dto.subject_id,
          class_id: dto.class_id,
          semester,
        },
      },
      create: { faculty_id: faculty.id, subject_id: dto.subject_id, class_id: dto.class_id, semester },
      update: {},
    });

    const last = await this.prisma.lesson_plan_sessions.findFirst({
      where: { lesson_plan_id: plan.id },
      orderBy: { sequence_no: 'desc' },
    });

    const session = await this.prisma.lesson_plan_sessions.create({
      data: {
        lesson_plan_id: plan.id,
        session_date: new Date(dto.session_date),
        unit_title: dto.unit_title,
        topic: dto.topic,
        sequence_no: (last?.sequence_no ?? 0) + 1,
      },
    });

    return { id: session.id };
  }

  /** PATCH /me/lms/lesson-plan/sessions/:id (Faculty/HoD, own session). */
  async updateLessonSession(sessionId: number, dto: UpdateLessonSessionDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const session = await this.getOwnedSession(sessionId, faculty.id);

    await this.prisma.lesson_plan_sessions.update({
      where: { id: session.id },
      data: {
        session_date: dto.session_date ? new Date(dto.session_date) : undefined,
        unit_title: dto.unit_title,
        topic: dto.topic,
        is_covered: dto.is_covered,
      },
    });

    return { id: sessionId, updated: true };
  }

  /** DELETE /me/lms/lesson-plan/sessions/:id (Faculty/HoD, own session). */
  async deleteLessonSession(sessionId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const session = await this.getOwnedSession(sessionId, faculty.id);
    await this.prisma.lesson_plan_sessions.delete({ where: { id: session.id } });
    return { id: sessionId, deleted: true };
  }

  // ============================================================
  // Shared helpers
  // ============================================================

  private isStudentRole(role: string): boolean {
    return role === 'student';
  }

  private async fetchLessonPlan(subjectId: number, classId: number, requireFacultyId?: number) {
    const plan = await this.prisma.lesson_plans.findFirst({
      where: {
        subject_id: subjectId,
        class_id: classId,
        ...(requireFacultyId ? { faculty_id: requireFacultyId } : {}),
      },
      select: {
        id: true,
        lesson_plan_sessions: { orderBy: { sequence_no: 'asc' } },
      },
    });

    if (!plan) return { sessions: [] };

    return {
      sessions: plan.lesson_plan_sessions.map((s) => ({
        id: s.id,
        session_date: s.session_date.toISOString().slice(0, 10),
        unit_title: s.unit_title,
        topic: s.topic,
        is_covered: s.is_covered,
      })),
    };
  }

  private async assertTeachesAllClasses(facultyId: number, subjectId: number, classIds: number[]) {
    const mappings = await this.prisma.faculty_subject_class_mapping.findMany({
      where: { faculty_id: facultyId, subject_id: subjectId, class_id: { in: classIds } },
      select: { class_id: true },
    });
    const mappedClassIds = new Set(mappings.map((m) => m.class_id));
    const missing = classIds.filter((id) => !mappedClassIds.has(id));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `You are not assigned to teach subject ${subjectId} for class(es): ${missing.join(', ')}`,
      );
    }
  }

  private async getOwnedFolder(folderId: number, facultyId: number) {
    const folder = await this.prisma.lms_folders.findUnique({ where: { id: folderId } });
    if (!folder) {
      throw new NotFoundException({ message: 'Folder not found', errorCode: 'FOLDER_NOT_FOUND' });
    }
    if (folder.faculty_id !== facultyId) {
      throw new ForbiddenException('You may only manage your own folders');
    }
    return folder;
  }

  private async getOwnedSession(sessionId: number, facultyId: number) {
    const session = await this.prisma.lesson_plan_sessions.findUnique({
      where: { id: sessionId },
      select: { id: true, lesson_plans: { select: { faculty_id: true } } },
    });
    if (!session) {
      throw new NotFoundException({ message: 'Session not found', errorCode: 'SESSION_NOT_FOUND' });
    }
    if (session.lesson_plans.faculty_id !== facultyId) {
      throw new ForbiddenException('You may only manage your own lesson plan sessions');
    }
    return session;
  }

  private async resolveFacultyByUserId(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({ where: { user_id: userId } });
    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty profile not found for the authenticated user',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty;
  }

  private async resolveStudentByUserId(userId: number) {
    const student = await this.prisma.students.findUnique({ where: { user_id: userId } });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for the authenticated user',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    return student;
  }
}
