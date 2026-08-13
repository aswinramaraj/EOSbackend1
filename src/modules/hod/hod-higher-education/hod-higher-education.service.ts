import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { computeGpa, isPassingPercentage } from '../shared/grade-scale.util';

function toPercentage(marksObtained: unknown, maxMarks: unknown): number {
  const scored = Number(marksObtained);
  const max = Number(maxMarks);
  return max > 0 ? (scored / max) * 100 : 0;
}

function studentName(
  soa: { first_name: string; last_name: string | null } | null,
  email: string,
): string {
  if (!soa) return email;
  return (
    [soa.first_name, soa.last_name].filter(Boolean).join(' ').trim() || email
  );
}

function isOverseas(country: string): boolean {
  return country.trim().toLowerCase() !== 'india';
}

function humanizeEnum(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function toDateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

@Injectable()
export class HodHigherEducationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolves the caller's own faculty row + department — never trusts a client-supplied department_id. */
  private async resolveHodDepartment(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true, department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    const department = await this.prisma.departments.findUnique({
      where: { id: faculty.department_id },
      select: { id: true, name: true, code: true },
    });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    return { faculty, department };
  }

  /**
   * GET /hod/higher-education?search=&batch_id=&programme=
   * "All departments" from the reference design is dropped — a HOD only ever
   * has one department, everywhere else in this app — and replaced with a
   * real, useful filter for this data specifically: by programme, since a
   * HOD's own department realistically spans several distinct postgraduate
   * programmes.
   */
  async getRecords(
    userId: number,
    search?: string,
    batchId?: number,
    programme?: string,
  ) {
    const { department } = await this.resolveHodDepartment(userId);

    const records = await this.prisma.student_higher_education.findMany({
      where: {
        students: {
          classes: { department_id: department.id },
          ...(batchId != null ? { batch_id: batchId } : {}),
        },
        ...(programme ? { preferred_course: programme } : {}),
        ...(search
          ? {
              OR: [
                { preferred_course: { contains: search, mode: 'insensitive' } },
                {
                  preferred_university: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  preferred_country: { contains: search, mode: 'insensitive' },
                },
                {
                  students: {
                    student_id_no: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  students: {
                    soa_applications: {
                      OR: [
                        {
                          first_name: { contains: search, mode: 'insensitive' },
                        },
                        {
                          last_name: { contains: search, mode: 'insensitive' },
                        },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        preferred_course: true,
        preferred_country: true,
        preferred_university: true,
        remarks: true,
        is_scholarship: true,
        scholarship_name: true,
        admission_status: true,
        students: {
          select: {
            id: true,
            student_id_no: true,
            photo_url: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
            classes: {
              select: {
                departments: { select: { code: true } },
                batches: {
                  select: { id: true, start_year: true, end_year: true },
                },
              },
            },
          },
        },
      },
      orderBy: { id: 'desc' },
    });

    const rows = records.map((r) => ({
      id: r.id,
      student_id: r.students.id,
      student_id_no: r.students.student_id_no,
      name: studentName(r.students.soa_applications, r.students.users.email),
      photo_url: r.students.photo_url,
      department_code: r.students.classes?.departments?.code ?? department.code,
      batch_label: r.students.classes?.batches
        ? `${r.students.classes.batches.start_year}-${r.students.classes.batches.end_year}`
        : null,
      programme: r.preferred_course,
      university: r.preferred_university,
      country: r.preferred_country,
      remarks: r.remarks,
      scholarship: r.is_scholarship ? r.scholarship_name ?? 'Yes' : null,
      status: r.admission_status,
    }));

    const totalCount = rows.length;
    const overseasRows = rows.filter((r) => isOverseas(r.country));
    const overseasCount = overseasRows.length;
    const domesticCount = totalCount - overseasCount;
    const countries = [...new Set(rows.map((r) => r.country))].sort();

    // Filter option lists — every batch/programme that actually has a
    // higher-education record in this department, not every batch/course
    // the department has ever run.
    const batchOptions = new Map<number, string>();
    const programmeOptions = new Set<string>();
    for (const record of records) {
      const batch = record.students.classes?.batches;
      if (batch)
        batchOptions.set(batch.id, `${batch.start_year}-${batch.end_year}`);
      programmeOptions.add(record.preferred_course);
    }

    return {
      department,
      stats: {
        total: totalCount,
        overseas_count: overseasCount,
        domestic_count: domesticCount,
        countries,
      },
      filters: {
        batches: [...batchOptions.entries()]
          .map(([id, label]) => ({ batch_id: id, label }))
          .sort((a, b) => b.batch_id - a.batch_id),
        programmes: [...programmeOptions].sort(),
      },
      rows,
    };
  }

  /**
   * GET /hod/higher-education/:id — the venture/programme-file view opened
   * from a row on the list page. CGPA/percentage/backlogs are computed from
   * real exam_marks (same convention as hod-student-profile.service.ts).
   */
  async getProfile(userId: number, id: number) {
    const { department } = await this.resolveHodDepartment(userId);

    const record = await this.prisma.student_higher_education.findUnique({
      where: { id },
      select: {
        id: true,
        preferred_course: true,
        preferred_country: true,
        preferred_university: true,
        remarks: true,
        is_scholarship: true,
        scholarship_name: true,
        admission_status: true,
        scholarship_value: true,
        intake_term: true,
        sop_status: true,
        recommendation_status: true,
        research_output: true,
        internship_details: true,
        visa_status: true,
        application_submitted_date: true,
        interview_date: true,
        offer_status: true,
        funding_source: true,
        students: {
          select: {
            id: true,
            student_id_no: true,
            photo_url: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
            student_contacts: { select: { student_mobile: true } },
            student_sensitive_info: {
              select: { passport_number: true, passport_valid_until: true },
            },
            student_test_scores: {
              select: { test_name: true, score: true, test_date: true },
              orderBy: { test_date: 'desc' },
            },
            student_family_details: {
              select: {
                father_name: true,
                father_mobile: true,
                mother_name: true,
                mother_mobile: true,
              },
            },
            classes: {
              select: {
                department_id: true,
                departments: { select: { code: true } },
                batches: { select: { start_year: true, end_year: true } },
              },
            },
          },
        },
      },
    });
    if (!record || record.students.classes?.department_id !== department.id) {
      throw new NotFoundException(
        'Higher-education record not found in your department',
      );
    }

    const student = record.students;
    const family = student.student_family_details;
    const guardian = family?.father_name
      ? { name: family.father_name, mobile: family.father_mobile }
      : family?.mother_name
        ? { name: family.mother_name, mobile: family.mother_mobile }
        : null;

    const { cgpa, percentage, backlogs, credits_earned } =
      await this.getCgpaAndBacklogs(student.id);

    const passportInfo = student.student_sensitive_info;
    const passport = passportInfo?.passport_number
      ? passportInfo.passport_valid_until
        ? `${passportInfo.passport_number} · valid till ${toDateOnly(passportInfo.passport_valid_until)}`
        : passportInfo.passport_number
      : null;

    const testScores = student.student_test_scores;
    const testScoresSummary =
      testScores.length > 0
        ? testScores
            .map((t) => `${t.test_name} ${Number(t.score)}`)
            .join(' · ')
        : null;
    const latestTestDate = testScores.find((t) => t.test_date)?.test_date ?? null;

    return {
      id: record.id,
      student: {
        id: student.id,
        name: studentName(student.soa_applications, student.users.email),
        student_id_no: student.student_id_no,
        photo_url: student.photo_url,
        department_code: student.classes?.departments?.code ?? department.code,
        batch_label: student.classes?.batches
          ? `${student.classes.batches.start_year}-${student.classes.batches.end_year}`
          : null,
        mobile: student.student_contacts?.student_mobile ?? null,
        email: student.users.email,
        guardian,
      },
      admission: {
        status: record.admission_status,
        is_abroad: isOverseas(record.preferred_country),
        intake: record.intake_term,
      },
      academic: { cgpa, percentage, backlogs, credits_earned },
      programme: {
        course: record.preferred_course,
        university: record.preferred_university,
        country: record.preferred_country,
        intake: record.intake_term,
        statement_of_purpose: record.sop_status,
        recommendation: record.recommendation_status,
      },
      readiness: {
        research_output: record.research_output,
        internship: record.internship_details,
        passport,
        visa: humanizeEnum(record.visa_status),
      },
      timeline: {
        application_submitted: toDateOnly(record.application_submitted_date),
        test_score_reported: toDateOnly(latestTestDate),
        interview_date: toDateOnly(record.interview_date),
        offer_result: humanizeEnum(record.offer_status),
      },
      funding: {
        scholarship: record.is_scholarship ? record.scholarship_name ?? 'Yes' : null,
        scholarship_value:
          record.scholarship_value != null ? Number(record.scholarship_value) : null,
        loan_funding: record.funding_source,
      },
      test_scores: testScoresSummary,
      remarks: record.remarks,
    };
  }

  /** Same credit-weighted GPA + failing-subject-count convention as hod-student-profile.service.ts. */
  private async getCgpaAndBacklogs(studentId: number) {
    const rows = await this.prisma.exam_marks.findMany({
      where: {
        student_id: studentId,
        exam_subject_mapping: {
          exams: { exam_types: { category: 'external' } },
        },
      },
      select: {
        marks_obtained: true,
        max_marks: true,
        is_absent: true,
        exam_subject_mapping: {
          select: { subjects: { select: { credits: true } } },
        },
      },
    });
    const marks = rows.map((row) => ({
      is_absent: row.is_absent,
      percentage: toPercentage(row.marks_obtained, row.max_marks),
      credits: row.exam_subject_mapping.subjects.credits,
    }));
    const graded = marks.filter((m) => !m.is_absent);
    const cgpa = computeGpa(graded);
    const backlogs = marks.filter(
      (m) => m.is_absent || !isPassingPercentage(m.percentage),
    ).length;
    const creditsEarned = graded
      .filter((m) => isPassingPercentage(m.percentage))
      .reduce((sum, m) => sum + (m.credits ?? 0), 0);
    return {
      cgpa,
      percentage: cgpa != null ? Math.round(cgpa * 9.5 * 10) / 10 : null,
      backlogs,
      credits_earned: creditsEarned,
    };
  }
}
