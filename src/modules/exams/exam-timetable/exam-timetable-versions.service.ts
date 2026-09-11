import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const INCLUDE = {
  exams: {
    select: {
      academic_year: true,
      semester: true,
      exam_category: true,
      exam_type_id: true,
      exam_types: { select: { name: true } },
    },
  },
  _count: { select: { exam_timetable: true } },
} as const;

@Injectable()
export class ExamTimetableVersionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /exam-timetable-versions?exam_id= — one exam's version history, or every version across every exam (drives the Drafts/To publish/Published tabs) when exam_id is omitted. */
  async findAll(examId?: number) {
    const rows = await this.prisma.exam_timetable_versions.findMany({
      where: examId ? { exam_id: examId } : {},
      include: INCLUDE,
      orderBy: [{ exam_id: 'asc' }, { version_number: 'desc' }],
    });

    // Real department coverage per exam — a version has no department_id of
    // its own (exam_timetable rows span whichever classes/departments the
    // exam's mappings cover), so this is derived from exam_subject_mapping,
    // not stored on the version.
    const examIds = [...new Set(rows.map((r) => r.exam_id))];
    const mappings = examIds.length
      ? await this.prisma.exam_subject_mapping.findMany({
          where: { exam_id: { in: examIds } },
          select: {
            exam_id: true,
            classes: { select: { departments: { select: { code: true } } } },
          },
        })
      : [];
    const deptCodesByExam = new Map<number, Set<string>>();
    for (const m of mappings) {
      const set = deptCodesByExam.get(m.exam_id) ?? new Set<string>();
      set.add(m.classes.departments.code);
      deptCodesByExam.set(m.exam_id, set);
    }

    return rows.map((v) => ({
      id: v.id,
      exam_id: v.exam_id,
      version_number: v.version_number,
      status: v.status,
      created_at: v.created_at,
      published_at: v.published_at,
      withdrawn_at: v.withdrawn_at,
      cloned_from_version_id: v.cloned_from_version_id,
      paper_count: v._count.exam_timetable,
      exam: {
        academic_year: v.exams.academic_year,
        semester: v.exams.semester,
        exam_category: v.exams.exam_category,
        exam_type_id: v.exams.exam_type_id,
        exam_type_name: v.exams.exam_types.name,
        department_codes: [...(deptCodesByExam.get(v.exam_id) ?? [])].sort(),
      },
    }));
  }

  /** GET /exam-timetable-versions/:id/schedule — a read-only day/session/course/hall listing for one specific version, for the Drafts/Published tabs' "View" action. */
  async getSchedule(id: number) {
    const version = await this.prisma.exam_timetable_versions.findUnique({
      where: { id },
    });
    if (!version) {
      throw new NotFoundException({
        message: 'Timetable version not found.',
        errorCode: 'TIMETABLE_VERSION_NOT_FOUND',
      });
    }

    const entries = await this.prisma.exam_timetable.findMany({
      where: { version_id: id },
      include: {
        exam_subject_mapping: {
          include: {
            subjects: { select: { subject_code: true, name: true } },
            classes: { select: { departments: { select: { code: true } } } },
          },
        },
        venues: { select: { name: true } },
      },
      orderBy: [{ exam_date: 'asc' }, { session: 'asc' }],
    });

    return entries.map((e) => ({
      date: e.exam_date.toISOString().slice(0, 10),
      session: e.session,
      subject_code: e.exam_subject_mapping.subjects.subject_code,
      subject_name: e.exam_subject_mapping.subjects.name,
      department_code: e.exam_subject_mapping.classes.departments.code,
      hall: e.venues?.name ?? null,
    }));
  }

  /** DELETE /exam-timetable-versions/:id — only ever a draft; published/superseded/withdrawn versions are kept as real history. */
  async remove(id: number) {
    const version = await this.prisma.exam_timetable_versions.findUnique({
      where: { id },
    });
    if (!version) {
      throw new NotFoundException({
        message: 'Timetable version not found.',
        errorCode: 'TIMETABLE_VERSION_NOT_FOUND',
      });
    }
    if (version.status !== 'draft') {
      throw new BadRequestException({
        message: 'Only a draft version can be deleted.',
        errorCode: 'NOT_A_DRAFT',
      });
    }
    await this.prisma.exam_timetable_versions.delete({ where: { id } });
  }

  /** POST /exam-timetable-versions/:id/withdraw — pulls a published version back offline; students immediately lose access via the same is_published flag /me/exam-schedule already checks. */
  async withdraw(id: number) {
    const version = await this.prisma.exam_timetable_versions.findUnique({
      where: { id },
    });
    if (!version) {
      throw new NotFoundException({
        message: 'Timetable version not found.',
        errorCode: 'TIMETABLE_VERSION_NOT_FOUND',
      });
    }
    if (version.status !== 'published') {
      throw new BadRequestException({
        message: 'Only a published version can be withdrawn.',
        errorCode: 'NOT_PUBLISHED',
      });
    }

    const entries = await this.prisma.exam_timetable.findMany({
      where: { version_id: id },
      select: { exam_subject_mapping_id: true },
    });

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.exam_timetable_versions.update({
        where: { id },
        data: { status: 'withdrawn', withdrawn_at: new Date() },
      });
      await tx.exam_subject_mapping.updateMany({
        where: { id: { in: entries.map((e) => e.exam_subject_mapping_id) } },
        data: { is_published: false, published_at: null },
      });
      return updated;
    });
  }

  /**
   * Every write in exam-timetable.service.ts goes through this instead of
   * blindly reusing whichever version already exists — once a version is
   * published it's live for students, so further drag-and-drop edits must
   * land on a fresh draft cloned from it, never silently mutate it.
   * Exam-wide only (department_id: null) — matches the single implicit
   * version every exam already had before this feature existed, so no
   * existing exam_timetable row needs migrating to a new scope.
   */
  async getOrCreateEditableVersion(examId: number) {
    const latest = await this.prisma.exam_timetable_versions.findFirst({
      where: { exam_id: examId, department_id: null },
      orderBy: { version_number: 'desc' },
    });
    if (!latest) {
      return this.prisma.exam_timetable_versions.create({
        data: { exam_id: examId, version_number: 1, status: 'draft' },
      });
    }
    if (latest.status === 'draft' || latest.status === 'ready_to_publish') {
      return latest;
    }

    const clone = await this.prisma.exam_timetable_versions.create({
      data: {
        exam_id: examId,
        version_number: latest.version_number + 1,
        status: 'draft',
        cloned_from_version_id: latest.id,
      },
    });
    const sourceEntries = await this.prisma.exam_timetable.findMany({
      where: { version_id: latest.id },
    });
    if (sourceEntries.length > 0) {
      await this.prisma.exam_timetable.createMany({
        data: sourceEntries.map((e) => ({
          exam_subject_mapping_id: e.exam_subject_mapping_id,
          exam_date: e.exam_date,
          start_time: e.start_time,
          end_time: e.end_time,
          session: e.session,
          venue_id: e.venue_id,
          version_id: clone.id,
        })),
      });
    }
    return clone;
  }

  /** POST /exam-timetable-versions/move-to-draft — confirms the current working version as an official Draft (pulling it back from ready_to_publish if needed). */
  async moveToDraft(examId: number, userId?: number) {
    const version = await this.getOrCreateEditableVersion(examId);
    if (version.status === 'draft') return version;
    return this.prisma.exam_timetable_versions.update({
      where: { id: version.id },
      data: {
        status: 'draft',
        created_by_user_id: version.created_by_user_id ?? userId,
      },
    });
  }

  /** POST /exam-timetable-versions/:id/publish — makes this version live for students; any previously-published version of the same exam is superseded. */
  async publish(id: number, userId?: number) {
    const version = await this.prisma.exam_timetable_versions.findUnique({
      where: { id },
    });
    if (!version) {
      throw new NotFoundException({
        message: 'Timetable version not found.',
        errorCode: 'TIMETABLE_VERSION_NOT_FOUND',
      });
    }

    const entries = await this.prisma.exam_timetable.findMany({
      where: { version_id: id },
      select: { exam_subject_mapping_id: true },
    });

    await this.prisma.$transaction([
      this.prisma.exam_timetable_versions.updateMany({
        where: {
          exam_id: version.exam_id,
          department_id: version.department_id,
          status: 'published',
        },
        data: { status: 'superseded' },
      }),
      this.prisma.exam_timetable_versions.update({
        where: { id },
        data: {
          status: 'published',
          published_at: new Date(),
          published_by_user_id: userId,
        },
      }),
      this.prisma.exam_subject_mapping.updateMany({
        where: { id: { in: entries.map((e) => e.exam_subject_mapping_id) } },
        data: { is_published: true, published_at: new Date() },
      }),
    ]);

    return this.prisma.exam_timetable_versions.findUnique({ where: { id } });
  }
}
