import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListBundlesQueryDto } from './dto/list-bundles-query.dto';
import { AllocateBundleDto } from './dto/allocate-bundle.dto';
import { EnterScriptMarkDto } from './dto/enter-script-mark.dto';

const FACULTY_SELECT = { id: true, first_name: true, last_name: true } as const;

const INCLUDE = {
  faculty: { select: FACULTY_SELECT },
  exam_subject_mapping: {
    select: {
      id: true,
      exam_id: true,
      subjects: { select: { id: true, name: true, subject_code: true } },
      classes: { select: { department_id: true, departments: { select: { id: true, code: true, name: true } } } },
    },
  },
  script_bundle_marks: { select: { id: true, dummy_number: true, total_marks: true, is_absent: true } },
} as const;

@Injectable()
export class ScriptBundlesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListBundlesQueryDto) {
    const where: Prisma.script_bundlesWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.is_second_valuation !== undefined) where.is_second_valuation = query.is_second_valuation;

    const mappingWhere: Prisma.exam_subject_mappingWhereInput = {};
    if (query.exam_id) mappingWhere.exam_id = query.exam_id;
    if (query.department_id) mappingWhere.classes = { department_id: query.department_id };
    if (Object.keys(mappingWhere).length > 0) where.exam_subject_mapping = mappingWhere;

    if (query.search) {
      where.OR = [
        { bundle_code: { contains: query.search, mode: 'insensitive' } },
        { exam_subject_mapping: { subjects: { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { subject_code: { contains: query.search, mode: 'insensitive' } }] } } },
        { faculty: { OR: [{ first_name: { contains: query.search, mode: 'insensitive' } }, { last_name: { contains: query.search, mode: 'insensitive' } }] } },
      ];
    }

    const bundles = await this.prisma.script_bundles.findMany({ where, include: INCLUDE, orderBy: { id: 'desc' } });
    return bundles.map((b) => ({
      id: b.id,
      exam_id: b.exam_subject_mapping.exam_id,
      bundle_code: b.bundle_code,
      dummy_range_start: b.dummy_range_start,
      dummy_range_end: b.dummy_range_end,
      subject: b.exam_subject_mapping.subjects,
      department: b.exam_subject_mapping.classes?.departments ?? null,
      valuator: b.faculty,
      scripts_count: b.scripts_count,
      entered_count: b.script_bundle_marks.filter((m) => m.total_marks != null || m.is_absent).length,
      status: b.status,
      is_second_valuation: b.is_second_valuation,
    }));
  }

  async getStats(examId: number) {
    const bundles = await this.prisma.script_bundles.findMany({
      where: { exam_subject_mapping: { exam_id: examId } },
      include: { script_bundle_marks: { select: { total_marks: true, is_absent: true } } },
    });

    const scriptsValued = bundles.reduce((sum, b) => sum + b.script_bundle_marks.filter((m) => m.total_marks != null || m.is_absent).length, 0);
    const totalScripts = bundles.reduce((sum, b) => sum + b.scripts_count, 0);
    const valuatorIds = new Set(bundles.map((b) => b.valuator_faculty_id).filter(Boolean));

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const enteredToday = await this.prisma.script_bundle_marks.count({
      where: { bundle_id: { in: bundles.map((b) => b.id) }, entered_at: { gte: startOfToday } },
    });

    return {
      scripts_valued: scriptsValued,
      total_scripts: totalScripts,
      valuators_on_camp: valuatorIds.size,
      second_valuation_count: bundles.filter((b) => b.is_second_valuation).length,
      bundles_count: bundles.length,
      daily_throughput: enteredToday,
    };
  }

  async allocate(dto: AllocateBundleDto) {
    const mapping = await this.prisma.exam_subject_mapping.findUnique({ where: { id: dto.exam_subject_mapping_id } });
    if (!mapping) throw new NotFoundException({ message: 'Exam subject mapping not found.', errorCode: 'MAPPING_NOT_FOUND' });

    if (dto.dummy_range_end < dto.dummy_range_start) {
      throw new BadRequestException({ message: 'dummy_range_end must be >= dummy_range_start.', errorCode: 'INVALID_RANGE' });
    }

    const scriptsCount = dto.dummy_range_end - dto.dummy_range_start + 1;

    // The real students whose scripts these dummy numbers stand in for —
    // assigned once, here, in a fixed order (by id) so the mapping is
    // reproducible. This is what lets a submitted bundle's marks later be
    // de-anonymized into the official exam_marks table.
    const classStudents = await this.prisma.students.findMany({
      where: { class_id: mapping.class_id, status: 'active' },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: scriptsCount,
    });

    return this.prisma.$transaction(async (tx) => {
      const bundle = await tx.script_bundles.create({
        data: {
          bundle_code: dto.bundle_code,
          exam_subject_mapping_id: dto.exam_subject_mapping_id,
          valuator_faculty_id: dto.valuator_faculty_id,
          dummy_range_start: dto.dummy_range_start,
          dummy_range_end: dto.dummy_range_end,
          scripts_count: scriptsCount,
          expected_return_at: dto.expected_return_at ? new Date(dto.expected_return_at) : undefined,
          status: dto.valuator_faculty_id ? 'under_valuation' : 'allotted',
        },
        include: INCLUDE,
      });

      if (classStudents.length > 0) {
        await tx.script_bundle_scripts.createMany({
          data: classStudents.map((s, i) => ({
            bundle_id: bundle.id,
            dummy_number: dto.dummy_range_start + i,
            student_id: s.id,
          })),
        });
      }

      return bundle;
    });
  }

  async getMarkSheet(bundleId: number) {
    const bundle = await this.prisma.script_bundles.findUnique({ where: { id: bundleId }, include: INCLUDE });
    if (!bundle) throw new NotFoundException({ message: 'Bundle not found.', errorCode: 'BUNDLE_NOT_FOUND' });

    const marks = await this.prisma.script_bundle_marks.findMany({ where: { bundle_id: bundleId } });
    const byDummy = new Map(marks.map((m) => [m.dummy_number, m]));

    const rows: {
      dummy_number: number;
      part_a_marks: number | null;
      part_b_marks: number | null;
      part_c_marks: number | null;
      total_marks: number | null;
      is_absent: boolean;
    }[] = [];
    for (let d = bundle.dummy_range_start; d <= bundle.dummy_range_end; d++) {
      const m = byDummy.get(d);
      rows.push({
        dummy_number: d,
        part_a_marks: m?.part_a_marks != null ? Number(m.part_a_marks) : null,
        part_b_marks: m?.part_b_marks != null ? Number(m.part_b_marks) : null,
        part_c_marks: m?.part_c_marks != null ? Number(m.part_c_marks) : null,
        total_marks: m?.total_marks != null ? Number(m.total_marks) : null,
        is_absent: m?.is_absent ?? false,
      });
    }

    return {
      bundle: { id: bundle.id, bundle_code: bundle.bundle_code, status: bundle.status, subject: bundle.exam_subject_mapping.subjects, valuator: bundle.faculty },
      rows,
    };
  }

  async enterMark(bundleId: number, dto: EnterScriptMarkDto) {
    const bundle = await this.prisma.script_bundles.findUnique({ where: { id: bundleId } });
    if (!bundle) throw new NotFoundException({ message: 'Bundle not found.', errorCode: 'BUNDLE_NOT_FOUND' });
    if (dto.dummy_number < bundle.dummy_range_start || dto.dummy_number > bundle.dummy_range_end) {
      throw new BadRequestException({ message: 'Dummy number is outside this bundle range.', errorCode: 'DUMMY_OUT_OF_RANGE' });
    }

    const total = dto.is_absent ? null : (dto.part_a_marks ?? 0) + (dto.part_b_marks ?? 0) + (dto.part_c_marks ?? 0);

    await this.prisma.script_bundle_marks.upsert({
      where: { bundle_id_dummy_number: { bundle_id: bundleId, dummy_number: dto.dummy_number } },
      create: {
        bundle_id: bundleId,
        dummy_number: dto.dummy_number,
        part_a_marks: dto.part_a_marks,
        part_b_marks: dto.part_b_marks,
        part_c_marks: dto.part_c_marks,
        total_marks: total,
        is_absent: dto.is_absent ?? false,
        entered_at: new Date(),
      },
      update: {
        part_a_marks: dto.part_a_marks,
        part_b_marks: dto.part_b_marks,
        part_c_marks: dto.part_c_marks,
        total_marks: total,
        is_absent: dto.is_absent ?? false,
        entered_at: new Date(),
      },
    });

    if (bundle.status === 'allotted') {
      await this.prisma.script_bundles.update({ where: { id: bundleId }, data: { status: 'under_valuation' } });
    }

    return this.getMarkSheet(bundleId);
  }

  async submitBundle(bundleId: number) {
    const bundle = await this.prisma.script_bundles.findUnique({ where: { id: bundleId } });
    if (!bundle) throw new NotFoundException({ message: 'Bundle not found.', errorCode: 'BUNDLE_NOT_FOUND' });

    const enteredCount = await this.prisma.script_bundle_marks.count({ where: { bundle_id: bundleId } });
    const expected = bundle.dummy_range_end - bundle.dummy_range_start + 1;
    if (enteredCount < expected) {
      throw new BadRequestException({ message: `${expected - enteredCount} scripts still blank.`, errorCode: 'INCOMPLETE_SHEET' });
    }

    const updated = await this.prisma.script_bundles.update({
      where: { id: bundleId },
      data: { status: 'submitted', submitted_at: new Date() },
      include: INCLUDE,
    });

    await this.transferMarksToExamMarks(bundle.id, bundle.exam_subject_mapping_id, bundle.valuator_faculty_id);

    return updated;
  }

  /**
   * De-anonymizes a submitted bundle's dummy-numbered marks into the
   * official exam_marks table via script_bundle_scripts (the real
   * dummy-number -> student register created at allocation time). Scaled
   * to the real external_max_marks from exam_pass_rules_settings — the
   * same convention every other exam_marks writer already uses, since the
   * raw script total here is always out of 100 (40 + 36 + 24).
   */
  private async transferMarksToExamMarks(bundleId: number, examSubjectMappingId: number, valuatorFacultyId: number | null) {
    const [scripts, marks, passRules] = await Promise.all([
      this.prisma.script_bundle_scripts.findMany({ where: { bundle_id: bundleId } }),
      this.prisma.script_bundle_marks.findMany({ where: { bundle_id: bundleId } }),
      this.prisma.exam_pass_rules_settings.findFirst(),
    ]);
    if (scripts.length === 0 || !passRules) return;

    const studentByDummy = new Map(scripts.map((s) => [s.dummy_number, s.student_id]));
    const externalMax = Number(passRules.external_max_marks);

    for (const mark of marks) {
      const studentId = studentByDummy.get(mark.dummy_number);
      if (studentId == null) continue;

      const scaled = mark.is_absent || mark.total_marks == null ? null : Math.round(((Number(mark.total_marks) * externalMax) / 100) * 100) / 100;

      await this.prisma.exam_marks.upsert({
        where: { exam_subject_mapping_id_student_id: { exam_subject_mapping_id: examSubjectMappingId, student_id: studentId } },
        create: {
          exam_subject_mapping_id: examSubjectMappingId,
          student_id: studentId,
          marks_obtained: scaled,
          max_marks: externalMax,
          is_absent: mark.is_absent,
          entered_by_faculty_id: valuatorFacultyId,
          entered_at: mark.entered_at ?? new Date(),
        },
        update: {
          marks_obtained: scaled,
          max_marks: externalMax,
          is_absent: mark.is_absent,
          entered_by_faculty_id: valuatorFacultyId,
          entered_at: mark.entered_at ?? new Date(),
        },
      });
    }
  }
}
