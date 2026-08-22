import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

export type AuditMilestoneStatus =
  'Completed' | 'Pending' | 'Overdue' | 'Not started';

interface Milestone {
  label: string;
  status: AuditMilestoneStatus;
}

@Injectable()
export class AcademicCoordinatorAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/coordinator/audit?department_id=&semester=&batch_id=
   *
   * Every milestone below is computed live from a real, already-existing
   * table — no new schema, per the earlier decision that this page needs no
   * new tables. "Reports generated" is the one exception: no report-
   * generation log exists anywhere in the schema, so it's honestly reported
   * as Not started rather than faked.
   *
   * batch_id is required: the same department+semester pair can match
   * classes from more than one batch (e.g. two cohorts both sitting at
   * semester 5 in the same term), which would silently blend two cohorts'
   * completion numbers into one percentage without it.
   */
  async audit(departmentId: number, semester: number, batchId: number) {
    const classes = await this.prisma.classes.findMany({
      where: {
        department_id: departmentId,
        current_semester: semester,
        batch_id: batchId,
      },
      select: { id: true },
    });
    const classIds = classes.map((c) => c.id);

    const [
      subjectCount,
      classSubjectCount,
      facultyMappingCount,
      timetableCount,
      lessonPlanCount,
      attendanceCount,
      marksLockPublished,
      feedbackGeneralCount,
      feedbackFacultyCount,
      examsForDept,
      publishedMappingCount,
    ] = await Promise.all([
      this.prisma.subjects.count({ where: { department_id: departmentId } }),
      classIds.length
        ? this.prisma.class_subjects.count({
            where: { class_id: { in: classIds }, semester },
          })
        : 0,
      classIds.length
        ? this.prisma.faculty_subject_class_mapping.count({
            where: { class_id: { in: classIds } },
          })
        : 0,
      classIds.length
        ? this.prisma.timetable_slots.count({
            where: { class_id: { in: classIds } },
          })
        : 0,
      classIds.length
        ? this.prisma.lesson_plans.count({
            where: { class_id: { in: classIds }, semester },
          })
        : 0,
      classIds.length
        ? this.prisma.attendance_records.count({
            where: { class_id: { in: classIds } },
          })
        : 0,
      this.prisma.marks_entry_locks.count({
        where: { department_id: departmentId, is_published: true },
      }),
      classIds.length
        ? this.prisma.feedback_responses.count({
            where: {
              feedback_questions: {
                feedback_forms: { class_id: { in: classIds } },
              },
            },
          })
        : 0,
      classIds.length
        ? this.prisma.feedback_faculty_responses.count({
            where: {
              feedback_questions: {
                feedback_forms: { class_id: { in: classIds } },
              },
            },
          })
        : 0,
      this.prisma.exams.findMany({
        where: { semester },
        select: { status: true },
      }),
      classIds.length
        ? this.prisma.exam_subject_mapping.count({
            where: { class_id: { in: classIds }, is_published: true },
          })
        : 0,
    ]);

    const examsCompleted = examsForDept.some(
      (e) => e.status === 'completed' || e.status === 'results_published',
    );

    const milestones: Milestone[] = [
      {
        label: 'Curriculum created',
        status: subjectCount > 0 ? 'Completed' : 'Not started',
      },
      {
        label: 'Curriculum mapped',
        status: classSubjectCount > 0 ? 'Completed' : 'Pending',
      },
      {
        label: 'Faculty allocated',
        status: facultyMappingCount > 0 ? 'Completed' : 'Pending',
      },
      {
        label: 'Timetable published',
        status: timetableCount > 0 ? 'Completed' : 'Pending',
      },
      {
        label: 'Lesson plans submitted',
        status: lessonPlanCount > 0 ? 'Completed' : 'Pending',
      },
      {
        label: 'Attendance updated',
        status: attendanceCount > 0 ? 'Completed' : 'Pending',
      },
      {
        label: 'Internal marks submitted',
        status: marksLockPublished > 0 ? 'Completed' : 'Pending',
      },
      {
        label: 'Feedback collected',
        status:
          feedbackGeneralCount + feedbackFacultyCount > 0
            ? 'Completed'
            : 'Pending',
      },
      {
        label: 'Examinations completed',
        status: examsCompleted ? 'Completed' : 'Pending',
      },
      {
        label: 'Results updated',
        status: publishedMappingCount > 0 ? 'Completed' : 'Pending',
      },
      { label: 'Reports generated', status: 'Not started' },
    ];

    const completed = milestones.filter((m) => m.status === 'Completed').length;
    const percent = Math.round((completed / milestones.length) * 100);

    return {
      department_id: departmentId,
      semester,
      batch_id: batchId,
      percent_complete: percent,
      milestones,
    };
  }
}
