import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ListSpecialAdmissionsQueryDto } from './dto/list-special-admissions-query.dto';
import { NotifySpecialAdmissionDto } from './dto/notify-special-admission.dto';

// Real fields already on `students` — no schema change. `admission_type` is
// free text set by Admin's admission wizard (ADMISSION_TYPE_OPTIONS:
// Counselling / Management / Direct / Lateral Entry — confirmed against
// EditProfileModal.tsx/admissionWizardSections.ts on the frontend), so
// "Lateral Entry" is an exact, real signal. There's no equivalent option for
// a mid-course college transfer, so that category is derived instead: a
// student whose real `joined_academic_year` doesn't match the academic year
// their own real batch (`batches.start_year`) actually started in didn't
// join at the normal time — the same real signal Admin already fills in via
// the same wizard, just read from a different angle.
const STUDENT_SELECT = {
  id: true,
  user_id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
  admission_type: true,
  joined_academic_year: true,
  class_id: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  batches: { select: { id: true, name: true, start_year: true, end_year: true } },
  classes: {
    select: {
      id: true,
      section: true,
      current_semester: true,
      departments: { select: { id: true, code: true, name: true } },
    },
  },
} as const;

type StudentRow = Awaited<ReturnType<SpecialAdmissionsService['findCandidates']>>[number];

function expectedAcademicYear(startYear: number): string {
  return `${startYear}-${startYear + 1}`;
}

function categorize(student: StudentRow): 'lateral_entry' | 'transfer' | null {
  if (student.admission_type === 'Lateral Entry') return 'lateral_entry';
  if (student.joined_academic_year && student.joined_academic_year !== expectedAcademicYear(student.batches.start_year)) {
    return 'transfer';
  }
  return null;
}

@Injectable()
export class SpecialAdmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private findCandidates(departmentId?: number, classId?: number) {
    return this.prisma.students.findMany({
      where: {
        OR: [{ admission_type: { not: null } }, { joined_academic_year: { not: null } }],
        ...(classId ? { class_id: classId } : {}),
        ...(departmentId ? { classes: { department_id: departmentId } } : {}),
      },
      select: STUDENT_SELECT,
      orderBy: { id: 'desc' },
    });
  }

  async getList(query: ListSpecialAdmissionsQueryDto) {
    const candidates = await this.findCandidates(query.department_id, query.class_id);

    let rows = candidates
      .map((student) => ({ student, category: categorize(student) }))
      .filter((row): row is { student: StudentRow; category: 'lateral_entry' | 'transfer' } => row.category !== null);

    if (query.category) rows = rows.filter((row) => row.category === query.category);

    if (query.search) {
      const q = query.search.trim().toLowerCase();
      rows = rows.filter(({ student }) => {
        const name = student.soa_applications
          ? [student.soa_applications.first_name, student.soa_applications.last_name].filter(Boolean).join(' ').toLowerCase()
          : '';
        return (
          student.student_id_no.toLowerCase().includes(q) ||
          (student.register_no ?? '').toLowerCase().includes(q) ||
          name.includes(q)
        );
      });
    }

    const studentIds = rows.map((row) => row.student.id);
    const [marksCounts, malpracticeCounts, revaluationCounts] = await Promise.all([
      this.prisma.exam_marks.groupBy({ by: ['student_id'], where: { student_id: { in: studentIds } }, _count: { _all: true } }),
      this.prisma.malpractice_incidents.groupBy({ by: ['student_id'], where: { student_id: { in: studentIds } }, _count: { _all: true } }),
      this.prisma.revaluation_requests.groupBy({ by: ['student_id'], where: { student_id: { in: studentIds } }, _count: { _all: true } }),
    ]);
    const marksMap = new Map(marksCounts.map((m) => [m.student_id, m._count._all]));
    const malpracticeMap = new Map(malpracticeCounts.map((m) => [m.student_id, m._count._all]));
    const revaluationMap = new Map(revaluationCounts.map((m) => [m.student_id, m._count._all]));

    const data = rows.map(({ student, category }) => ({
      id: student.id,
      student_id_no: student.student_id_no,
      register_no: student.register_no,
      roll_no: student.roll_no,
      name: student.soa_applications
        ? [student.soa_applications.first_name, student.soa_applications.last_name].filter(Boolean).join(' ')
        : null,
      admission_type: student.admission_type,
      joined_academic_year: student.joined_academic_year,
      category,
      department: student.classes?.departments ?? null,
      class: student.classes ? { id: student.classes.id, section: student.classes.section, current_semester: student.classes.current_semester } : null,
      batch: { name: student.batches.name, expected_academic_year: expectedAcademicYear(student.batches.start_year) },
      papers_with_marks: marksMap.get(student.id) ?? 0,
      malpractice_count: malpracticeMap.get(student.id) ?? 0,
      revaluation_count: revaluationMap.get(student.id) ?? 0,
    }));

    return {
      data,
      stats: {
        total: data.length,
        lateral_entry_count: data.filter((d) => d.category === 'lateral_entry').length,
        transfer_count: data.filter((d) => d.category === 'transfer').length,
      },
    };
  }

  /**
   * Sends a real notification through the existing shared `notifications`
   * table/service (same one every other module uses) — no new table, no
   * change to the notifications-rest module. The student sees this in their
   * own portal's notification centre.
   */
  async notify(studentId: number, dto: NotifySpecialAdmissionDto) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { id: true, user_id: true },
    });
    if (!student) {
      throw new NotFoundException({ message: 'Student not found', errorCode: 'STUDENT_NOT_FOUND' });
    }

    await this.notifications.create({ user_id: student.user_id, title: dto.title, message: dto.message });
    return { notified: true };
  }
}
