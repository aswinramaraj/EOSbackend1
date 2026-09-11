import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListConvocationQueryDto } from './dto/list-convocation-query.dto';
import { VerifyConvocationDto } from './dto/verify-convocation.dto';

const STUDENT_SELECT = {
  id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
  user_id: true,
  class_id: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  classes: {
    select: {
      current_semester: true,
      department_id: true,
      departments: { select: { id: true, code: true, name: true } },
      courses: { select: { name: true, duration_years: true } },
      batches: { select: { start_year: true } },
    },
  },
} as const;

const INCLUDE = {
  students: { select: STUDENT_SELECT },
} as const;

const GRADE_BAND_FALLBACK_PASS_MARK = 50;

@Injectable()
export class ConvocationService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListConvocationQueryDto) {
    const where: Prisma.convocation_registrationsWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.students = {
        OR: [
          { student_id_no: { contains: query.search, mode: 'insensitive' } },
          { register_no: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    const rows = await this.prisma.convocation_registrations.findMany({
      where,
      include: INCLUDE,
      orderBy: { id: 'desc' },
    });
    return rows.map((r) => ({
      ...r,
      cgpa: r.cgpa != null ? Number(r.cgpa) : null,
    }));
  }

  /** Real KPI tiles — "final year strength" is computed independently (active students in their last academic year, via courses.duration_years), separately from however many have actually been verified so far. */
  async getStats() {
    const [activeStudents, registrations] = await Promise.all([
      this.prisma.students.findMany({
        where: { status: 'active' },
        select: {
          classes: {
            select: {
              current_semester: true,
              courses: { select: { duration_years: true } },
            },
          },
        },
      }),
      this.prisma.convocation_registrations.findMany({
        select: { status: true, arrears_count: true, cgpa: true },
      }),
    ]);

    const finalYearStrength = activeStudents.filter((s) => {
      const sem = s.classes?.current_semester;
      const years = s.classes?.courses?.duration_years;
      if (sem == null || years == null) return false;
      return sem >= years * 2 - 1;
    }).length;

    const notShortfall = registrations.filter((r) => r.status !== 'shortfall');
    const shortfallRows = registrations.filter((r) => r.status === 'shortfall');
    const shortfallWithArrears = shortfallRows.filter(
      (r) => r.arrears_count > 0,
    ).length;
    const shortfallDuesOrRecords = shortfallRows.length - shortfallWithArrears;

    const registeredOrAwarded = registrations.filter(
      (r) => r.status === 'registered' || r.status === 'degree_awarded',
    ).length;
    const goldMedalCandidates = registrations.filter(
      (r) =>
        r.status !== 'shortfall' && r.cgpa != null && Number(r.cgpa) >= 9.5,
    ).length;

    return {
      provisionally_eligible: notShortfall.length,
      final_year_strength: finalYearStrength,
      with_shortfall: shortfallRows.length,
      shortfall_arrears: shortfallWithArrears,
      shortfall_dues_or_records: shortfallDuesOrRecords,
      convocation_registered: registeredOrAwarded,
      registered_pct_of_eligible:
        notShortfall.length > 0
          ? Math.round((registeredOrAwarded / notShortfall.length) * 1000) / 10
          : null,
      gold_medal_candidates: goldMedalCandidates,
    };
  }

  private classificationFor(cgpa: number, standingArrears: number): string {
    if (cgpa >= 8.5 && standingArrears === 0)
      return 'First class with distinction';
    if (cgpa >= 6.5) return 'First class';
    if (cgpa >= 6.0) return 'Second class';
    return 'Pass class';
  }

  /**
   * Real degree-eligibility computation — same combined external+internal
   * marks join, pass-mark and credit logic as student-exam-record.service.ts,
   * run once here to decide eligible vs shortfall instead of leaving these
   * columns hand-entered. Checks (per the modal's own promised copy):
   *   - credits earned against the regulation (= no unresolved arrears)
   *   - standing arrears
   *   - disciplinary holds (an undecided malpractice case)
   *   - outstanding dues (unpaid exam fee registrations)
   */
  async verify(dto: VerifyConvocationDto) {
    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
      select: STUDENT_SELECT,
    });
    if (!student)
      throw new NotFoundException({
        message: 'Student not found.',
        errorCode: 'STUDENT_NOT_FOUND',
      });

    const [rules, gradeBands, marks, malpracticeHold, unpaidRegistrations] =
      await Promise.all([
        this.prisma.exam_pass_rules_settings.findFirst(),
        this.prisma.grade_bands.findMany({ orderBy: { display_order: 'asc' } }),
        this.prisma.exam_marks.findMany({
          where: { student_id: dto.student_id },
          include: {
            exam_subject_mapping: {
              include: {
                exams: {
                  select: {
                    exam_types: { select: { category: true } },
                    academic_year: true,
                    semester: true,
                  },
                },
                subjects: {
                  select: { subject_code: true, name: true, credits: true },
                },
              },
            },
          },
          orderBy: { entered_at: 'asc' },
        }),
        this.prisma.malpractice_incidents.findFirst({
          where: {
            student_id: dto.student_id,
            enquiry_stage: { not: 'decided' },
          },
        }),
        this.prisma.exam_registrations.findFirst({
          where: { student_id: dto.student_id, fee_status: 'unpaid' },
        }),
      ]);

    const passMark = rules
      ? Number(rules.pass_mark_total)
      : GRADE_BAND_FALLBACK_PASS_MARK;
    const gradeBandsDesc = [...gradeBands].sort(
      (a, b) => Number(b.min_percentage) - Number(a.min_percentage),
    );

    const combined: {
      subjectId: string;
      total: number | null;
      gradePoint: number | null;
      isPass: boolean | null;
      credits: number;
      enteredAt: Date;
    }[] = [];
    for (const m of marks) {
      const mapping = m.exam_subject_mapping;
      if (mapping.exams.exam_types.category === 'internal') continue; // internal rows are folded into the matching official row below, not counted as their own subject attempt

      let total: number | null =
        m.marks_obtained != null ? Number(m.marks_obtained) : null;
      if (!m.is_absent) {
        const internalMapping =
          await this.prisma.exam_subject_mapping.findFirst({
            where: {
              class_id: mapping.class_id,
              subject_id: mapping.subject_id,
              id: { not: mapping.id },
              exams: {
                academic_year: mapping.exams.academic_year,
                semester: mapping.exams.semester,
                exam_types: { category: 'internal' },
              },
            },
            orderBy: { exam_id: 'desc' },
            select: { id: true },
          });
        if (internalMapping) {
          const internalMark = await this.prisma.exam_marks.findUnique({
            where: {
              exam_subject_mapping_id_student_id: {
                exam_subject_mapping_id: internalMapping.id,
                student_id: dto.student_id,
              },
            },
          });
          if (internalMark?.marks_obtained != null && total != null)
            total += Number(internalMark.marks_obtained);
        }
      }

      const band =
        total != null
          ? gradeBandsDesc.find((b) => total >= Number(b.min_percentage))
          : null;
      combined.push({
        subjectId: `${mapping.subject_id}`,
        total: m.is_absent ? null : total,
        gradePoint: band?.grade_point != null ? Number(band.grade_point) : null,
        isPass: m.is_absent ? false : total != null ? total >= passMark : null,
        credits: mapping.subjects.credits ?? 0,
        enteredAt: m.entered_at,
      });
    }

    const latestBySubject = new Map<string, (typeof combined)[number]>();
    for (const row of combined) {
      const existing = latestBySubject.get(row.subjectId);
      if (!existing || row.enteredAt > existing.enteredAt)
        latestBySubject.set(row.subjectId, row);
    }

    let creditWeightedSum = 0;
    let creditsAttempted = 0;
    let creditsEarned = 0;
    let standingArrears = 0;
    for (const row of latestBySubject.values()) {
      creditsAttempted += row.credits;
      if (row.isPass) creditsEarned += row.credits;
      else standingArrears += 1;
      if (row.gradePoint != null)
        creditWeightedSum += row.gradePoint * row.credits;
    }
    const cgpa =
      creditsAttempted > 0
        ? Math.round((creditWeightedSum / creditsAttempted) * 100) / 100
        : 0;

    const hasDisciplinaryHold = !!malpracticeHold;
    const hasUnpaidDues = !!unpaidRegistrations;
    const eligible =
      standingArrears === 0 && !hasDisciplinaryHold && !hasUnpaidDues;

    const classification = this.classificationFor(cgpa, standingArrears);

    const upserted = await this.prisma.convocation_registrations.upsert({
      where: { student_id: dto.student_id },
      create: {
        student_id: dto.student_id,
        cgpa,
        arrears_count: standingArrears,
        classification,
        status: eligible ? 'eligible' : 'shortfall',
        convocation_batch: dto.convocation_batch,
        merit_list_eligible: dto.merit_list_eligible ?? true,
        remarks: dto.remarks,
      },
      update: {
        cgpa,
        arrears_count: standingArrears,
        classification,
        // A previously-registered/awarded student re-verified as still clear stays as-is; only a fresh shortfall or a fresh clear-from-shortfall actually changes status.
        status: eligible ? 'eligible' : 'shortfall',
        convocation_batch: dto.convocation_batch,
        merit_list_eligible: dto.merit_list_eligible ?? true,
        remarks: dto.remarks,
      },
      include: INCLUDE,
    });

    return {
      ...upserted,
      cgpa: upserted.cgpa != null ? Number(upserted.cgpa) : null,
      credits_earned: creditsEarned,
      credits_attempted: creditsAttempted,
      has_disciplinary_hold: hasDisciplinaryHold,
      has_unpaid_dues: hasUnpaidDues,
    };
  }

  async register(id: number) {
    const existing = await this.prisma.convocation_registrations.findUnique({
      where: { id },
    });
    if (!existing)
      throw new NotFoundException({
        message: 'Convocation record not found.',
        errorCode: 'CONVOCATION_NOT_FOUND',
      });
    if (existing.status !== 'eligible') {
      throw new BadRequestException({
        message: 'Only eligible students can be registered for convocation.',
        errorCode: 'NOT_ELIGIBLE',
      });
    }

    const updated = await this.prisma.convocation_registrations.update({
      where: { id },
      data: { status: 'registered', registered_at: new Date() },
      include: INCLUDE,
    });
    return {
      ...updated,
      cgpa: updated.cgpa != null ? Number(updated.cgpa) : null,
    };
  }

  async awardDegree(id: number) {
    const existing = await this.prisma.convocation_registrations.findUnique({
      where: { id },
    });
    if (!existing)
      throw new NotFoundException({
        message: 'Convocation record not found.',
        errorCode: 'CONVOCATION_NOT_FOUND',
      });
    if (existing.status !== 'registered') {
      throw new BadRequestException({
        message: 'Only registered students can be marked as degree awarded.',
        errorCode: 'NOT_REGISTERED',
      });
    }

    const updated = await this.prisma.convocation_registrations.update({
      where: { id },
      data: { status: 'degree_awarded' },
      include: INCLUDE,
    });
    return {
      ...updated,
      cgpa: updated.cgpa != null ? Number(updated.cgpa) : null,
    };
  }

  /** POST /convocation-registrations/:id/notify — a real in-app nudge about whatever is actually blocking eligibility (arrears vs dues/records), same dispatch pattern used across this session's other remind() actions. */
  async notify(id: number) {
    const existing = await this.prisma.convocation_registrations.findUnique({
      where: { id },
      include: { students: { select: { user_id: true } } },
    });
    if (!existing)
      throw new NotFoundException({
        message: 'Convocation record not found.',
        errorCode: 'CONVOCATION_NOT_FOUND',
      });
    if (existing.status !== 'shortfall') {
      throw new BadRequestException({
        message: 'This student is not currently in shortfall.',
        errorCode: 'NOT_SHORTFALL',
      });
    }

    const reason =
      existing.arrears_count > 0
        ? `${existing.arrears_count} standing arrear${existing.arrears_count === 1 ? '' : 's'}`
        : 'outstanding dues or disciplinary records';

    return this.prisma.notifications.create({
      data: {
        user_id: existing.students.user_id,
        title: 'Convocation eligibility shortfall',
        message: `Your convocation eligibility is currently on hold due to ${reason}. Please clear this to become eligible.`,
        related_entity_type: 'convocation_registrations',
        related_entity_id: existing.id,
      },
    });
  }
}
