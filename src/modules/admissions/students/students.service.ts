import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { AdminUpdateStudentDto } from './dto/admin-update-student.dto';
import { AdminAttendanceSummaryQueryDto } from './dto/admin-attendance-summary-query.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const STUDENT_LIST_SELECT = {
  id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
  admission_no: true,
  gender: true,
  date_of_birth: true,
  student_type: true,
  dayscholar_mode: true,
  status: true,
  admission_date: true,
  created_at: true,
  batches: { select: { id: true, name: true } },
  classes: { select: { id: true, section: true, current_semester: true } },
  courses: {
    select: {
      id: true,
      name: true,
      code: true,
      departments: { select: { id: true, name: true } },
    },
  },
  quotas: { select: { id: true, name: true } },
  users: { select: { id: true, email: true, phone: true, status: true } },
  soa_applications: { select: { first_name: true, last_name: true } },
} as const;

function toStudentDto(row: any) {
  return {
    id: row.id,
    student_id_no: row.student_id_no,
    roll_no: row.roll_no,
    register_no: row.register_no,
    admission_no: row.admission_no,
    first_name: row.soa_applications?.first_name ?? null,
    last_name: row.soa_applications?.last_name ?? null,
    email: row.users.email,
    phone: row.users.phone,
    gender: row.gender,
    date_of_birth: row.date_of_birth,
    student_type: row.student_type,
    dayscholar_mode: row.dayscholar_mode,
    status: row.status,
    admission_date: row.admission_date,
    created_at: row.created_at,
    batch: row.batches,
    class: row.classes,
    course: row.courses
      ? { id: row.courses.id, name: row.courses.name, code: row.courses.code }
      : null,
    department: row.courses?.departments ?? null,
    quota: row.quotas,
  };
}

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /students (Admin only) — paginated, searchable, filterable. */
  async findAll(query: ListStudentsQueryDto) {
    const where: any = {
      batch_id: query.batch_id,
      course_id: query.course_id,
      class_id: query.class_id,
      quota_id: query.quota_id,
      status: query.status,
      student_type: query.student_type,
    };

    if (query.department_id) {
      where.courses = { department_id: query.department_id };
    }

    if (query.q) {
      where.OR = [
        { student_id_no: { contains: query.q, mode: 'insensitive' } },
        { roll_no: { contains: query.q, mode: 'insensitive' } },
        { register_no: { contains: query.q, mode: 'insensitive' } },
        { admission_no: { contains: query.q, mode: 'insensitive' } },
        { users: { email: { contains: query.q, mode: 'insensitive' } } },
        {
          soa_applications: {
            first_name: { contains: query.q, mode: 'insensitive' },
          },
        },
        {
          soa_applications: {
            last_name: { contains: query.q, mode: 'insensitive' },
          },
        },
      ];
    }

    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.students.findMany({
          where,
          skip: query.skip,
          take: query.limit,
          orderBy: { id: 'desc' },
          select: STUDENT_LIST_SELECT,
        }),
        this.prisma.students.count({ where }),
      ],
      // See finance-overview.service.ts getOverview() for why timeout/maxWait
      // are both raised above their defaults.
      { timeout: 20_000, maxWait: 20_000 },
    );

    return paginate(rows.map(toStudentDto), total, query);
  }

  /** GET /students/:id (Admin only) */
  async findOne(id: number) {
    const row = await this.prisma.students.findUnique({
      where: { id },
      select: STUDENT_LIST_SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    return toStudentDto(row);
  }

  /**
   * GET /students/:id/attendance-summary (Admin only).
   *
   * Same aggregation as the self-scoped GET /me/attendance
   * (MeAttendanceService.getMyAttendance) — overall present/absent/percentage
   * plus a per-subject breakdown — but keyed by the :id path param instead of
   * the caller's own JWT, and from/to are optional (no filter = every
   * attendance_records row on file for this student).
   *
   * Error cases:
   *  400 VALIDATION_ERROR   – from > to
   *  404 STUDENT_NOT_FOUND  – no student with the given id
   *  404 SUBJECT_NOT_FOUND  – subject_id provided but doesn't exist
   */
  async getAttendanceSummary(
    id: number,
    query: AdminAttendanceSummaryQueryDto,
  ) {
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new BadRequestException({
        message: 'from must be before or equal to to',
        errorCode: 'VALIDATION_ERROR',
      });
    }

    const student = await this.prisma.students.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    if (query.subject_id !== undefined) {
      const subject = await this.prisma.subjects.findUnique({
        where: { id: query.subject_id },
      });
      if (!subject) {
        throw new NotFoundException({
          message: 'Subject not found',
          errorCode: 'SUBJECT_NOT_FOUND',
        });
      }
    }

    const records = await this.prisma.attendance_records.findMany({
      where: {
        student_id: id,
        ...((query.from || query.to) && {
          attendance_date: {
            ...(query.from && { gte: new Date(query.from) }),
            ...(query.to && { lte: new Date(query.to) }),
          },
        }),
        ...(query.subject_id !== undefined && { subject_id: query.subject_id }),
      },
      select: {
        attendance_date: true,
        subject_id: true,
        status: true,
        subjects: { select: { name: true } },
      },
      orderBy: { attendance_date: 'asc' },
    });

    const total_days = records.length;
    const present = records.filter((r) => r.status === 'present').length;
    const absent = records.filter((r) => r.status === 'absent').length;

    const bySubject = new Map<
      number,
      { subject_name: string; total: number; present: number }
    >();
    for (const record of records) {
      if (record.subject_id === null) continue;
      const entry = bySubject.get(record.subject_id) ?? {
        subject_name: record.subjects?.name ?? '',
        total: 0,
        present: 0,
      };
      entry.total += 1;
      if (record.status === 'present') entry.present += 1;
      bySubject.set(record.subject_id, entry);
    }

    return {
      overall: {
        total_days,
        present,
        absent,
        percentage: total_days > 0 ? round2((present / total_days) * 100) : 0,
      },
      by_subject: Array.from(bySubject.entries()).map(
        ([subject_id, entry]) => ({
          subject_id,
          subject_name: entry.subject_name,
          total: entry.total,
          present: entry.present,
          percentage: round2((entry.present / entry.total) * 100),
        }),
      ),
      records: records.map((record) => ({
        attendance_date: toDateOnly(record.attendance_date),
        subject_id: record.subject_id,
        status: record.status,
      })),
    };
  }

  /**
   * GET /students/:id/attendance-by-semester (Admin only).
   *
   * Buckets the student's real attendance_records into real semester date
   * ranges (academic_calendars, keyed by the student's batch), one summary
   * row per semester plus a day×subject register and an absence list for
   * each — the semester-selection master/detail view. Does not touch
   * getAttendanceSummary or its route; this is a separate, additive read.
   *
   * attendance_records has no period-of-day column (one row per
   * student/class/subject/date, not per period) — so unlike a
   * timetable-period grid, the day register's columns are subjects, the
   * real grain this schema actually captures.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – no student with the given id
   */
  async getAttendanceBySemester(id: number) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: { batch_id: true, class_id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const [terms, records, timetableSlots] = await Promise.all([
      this.prisma.academic_calendars.findMany({
        where: { batch_id: student.batch_id },
        select: { semester: true, start_date: true, end_date: true },
        orderBy: { semester: 'asc' },
      }),
      this.prisma.attendance_records.findMany({
        where: { student_id: id },
        select: {
          attendance_date: true,
          subject_id: true,
          status: true,
          subjects: { select: { name: true } },
        },
        orderBy: { attendance_date: 'asc' },
      }),
      student.class_id === null
        ? []
        : this.prisma.timetable_slots.findMany({
            where: { class_id: student.class_id },
            select: {
              day_of_week: true,
              period_number: true,
              subject_id: true,
              subjects: { select: { name: true } },
            },
            orderBy: [{ day_of_week: 'asc' }, { period_number: 'asc' }],
          }),
    ]);

    // day_of_week: 1 (Monday) – 6 (Saturday), matching CreateTimetableDto's
    // convention — which is also plain JS Date#getDay() (0=Sunday..6=Saturday)
    // for every day this schema actually uses, so attendance_date needs no
    // remapping beyond treating Sunday (getDay()===0) as "no periods".
    const timetableByDay = new Map<
      number,
      Array<{ period_number: number; subject_id: number; subject_name: string }>
    >();
    let maxPeriod = 0;
    for (const slot of timetableSlots) {
      const day = timetableByDay.get(slot.day_of_week) ?? [];
      day.push({
        period_number: slot.period_number,
        subject_id: slot.subject_id,
        subject_name: slot.subjects.name,
      });
      timetableByDay.set(slot.day_of_week, day);
      maxPeriod = Math.max(maxPeriod, slot.period_number);
    }
    const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);

    return terms.map((term) => {
      const termRecords = records.filter(
        (r) =>
          r.attendance_date >= term.start_date &&
          r.attendance_date <= term.end_date,
      );

      const total = termRecords.length;
      const present = termRecords.filter((r) => r.status === 'present').length;
      const absent = termRecords.filter((r) => r.status === 'absent').length;

      const dayMap = new Map<
        string,
        {
          subjects: Array<{
            subject_id: number | null;
            subject_name: string;
            status: string;
          }>;
          lost: number;
        }
      >();
      for (const r of termRecords) {
        const key = toDateOnly(r.attendance_date);
        const day = dayMap.get(key) ?? { subjects: [], lost: 0 };
        day.subjects.push({
          subject_id: r.subject_id,
          subject_name: r.subjects?.name ?? 'Whole day',
          status: r.status,
        });
        if (r.status === 'absent') day.lost += 1;
        dayMap.set(key, day);
      }

      const days = Array.from(dayMap.entries())
        .map(([date, day]) => {
          const wholeDayRecord = day.subjects.find(
            (s) => s.subject_id === null,
          );
          const jsDay = new Date(`${date}T00:00:00Z`).getUTCDay();
          const todaysPeriods = timetableByDay.get(jsDay) ?? [];

          const period_marks = periods.map((periodNumber) => {
            const slot = todaysPeriods.find(
              (p) => p.period_number === periodNumber,
            );
            if (!slot) {
              return {
                period_number: periodNumber,
                subject_name: null,
                status: null,
              };
            }
            const perSubjectRecord = day.subjects.find(
              (s) => s.subject_id === slot.subject_id,
            );
            const status =
              perSubjectRecord?.status ?? wholeDayRecord?.status ?? null;
            return {
              period_number: periodNumber,
              subject_name: slot.subject_name,
              status,
            };
          });

          return { date, ...day, period_marks };
        })
        .sort((a, b) => a.date.localeCompare(b.date));

      let runningTotal = 0;
      const absences = days
        .filter((d) => d.lost > 0)
        .map((d) => {
          runningTotal += d.lost;
          return {
            date: d.date,
            subjects_missed: d.subjects
              .filter((s) => s.status === 'absent')
              .map((s) => s.subject_name),
            lost: d.lost,
            running_total: runningTotal,
          };
        });

      return {
        semester: term.semester,
        from: toDateOnly(term.start_date),
        to: toDateOnly(term.end_date),
        working_days: new Set(
          termRecords.map((r) => toDateOnly(r.attendance_date)),
        ).size,
        present,
        absent,
        percentage: total > 0 ? round2((present / total) * 100) : 0,
        periods,
        days,
        absences,
      };
    });
  }

  /**
   * GET /students/:id/profile-details (Admin only).
   *
   * Admin-facing mirror of GET /me/profile (MeProfileService.getMyProfile) —
   * same tables (student_addresses, student_identity_marks,
   * student_family_details, student_contacts), keyed by the :id path param
   * instead of the caller's own JWT. student_sensitive_info (Aadhar/PAN) is
   * excluded here too, for the same reason as the self-service endpoint.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – no student with the given id
   */
  async getProfileDetails(id: number) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: {
        student_id_no: true,
        roll_no: true,
        register_no: true,
        student_type: true,
        gender: true,
        date_of_birth: true,
        blood_group: true,
        is_first_graduate: true,
        nationality: true,
        religion: true,
        community: true,
        mother_tongue: true,
        is_diff_abled: true,
        courses: { select: { name: true } },
        quotas: { select: { name: true } },
        classes: { select: { section: true } },
        batches: { select: { name: true } },
        student_addresses: {
          select: {
            address_type: true,
            address_line: true,
            city: true,
            state: true,
            pincode: true,
          },
        },
        student_identity_marks: {
          select: { mark_number: true, description: true },
        },
        student_family_details: {
          select: {
            father_name: true,
            father_qualification: true,
            father_occupation: true,
            father_annual_income: true,
            father_email: true,
            father_mobile: true,
            mother_name: true,
            mother_qualification: true,
            mother_occupation: true,
            mother_annual_income: true,
            mother_email: true,
            mother_mobile: true,
          },
        },
        student_contacts: {
          select: {
            student_email1: true,
            student_email2: true,
            student_mobile: true,
          },
        },
      },
    });

    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    return {
      student_id_no: student.student_id_no,
      roll_no: student.roll_no,
      register_no: student.register_no,
      course_name: student.courses?.name ?? null,
      quota_name: student.quotas?.name ?? null,
      batch_name: student.batches?.name ?? null,
      class_section: student.classes?.section ?? null,
      student_type: student.student_type,
      gender: student.gender,
      date_of_birth: student.date_of_birth
        ? student.date_of_birth.toISOString().slice(0, 10)
        : null,
      blood_group: student.blood_group,
      is_first_graduate: student.is_first_graduate,
      nationality: student.nationality,
      religion: student.religion,
      community: student.community,
      mother_tongue: student.mother_tongue,
      is_diff_abled: student.is_diff_abled,
      addresses: student.student_addresses,
      identity_marks: student.student_identity_marks,
      family_details: student.student_family_details,
      contacts: student.student_contacts,
    };
  }

  /**
   * GET /students/:id/family (Admin only).
   *
   * Just the student_family_details slice of getProfileDetails, for the
   * profile page's dedicated "Parents" section.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – no student with the given id
   */
  async getFamily(id: number) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: {
        student_family_details: {
          select: {
            father_name: true,
            father_qualification: true,
            father_occupation: true,
            father_annual_income: true,
            father_email: true,
            father_mobile: true,
            mother_name: true,
            mother_qualification: true,
            mother_occupation: true,
            mother_annual_income: true,
            mother_email: true,
            mother_mobile: true,
          },
        },
      },
    });

    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    return student.student_family_details;
  }

  /**
   * GET /students/:id/lifecycle (Admin only).
   *
   * Assembles the stage dates that already exist across three separate
   * tables into one fixed timeline — no new schema, just a join the rest of
   * the app never needed before: soa_applications.created_at (application
   * submitted), students.admission_date (admitted), students.status
   * (current standing), and an optional alumni_members row (graduated).
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – no student with the given id
   */
  async getLifecycle(id: number) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: {
        status: true,
        admission_date: true,
        soa_applications: { select: { created_at: true, status: true } },
        alumni_members: { select: { status: true, joined_at: true } },
      },
    });

    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    return {
      application_submitted_at: student.soa_applications?.created_at ?? null,
      application_status: student.soa_applications?.status ?? null,
      admitted_at: student.admission_date,
      current_status: student.status,
      alumni_status: student.alumni_members?.status ?? null,
      alumni_joined_at: student.alumni_members?.joined_at ?? null,
    };
  }

  /**
   * GET /students/:id/subjects (Admin only).
   *
   * The student's registered subjects for their class's current semester —
   * class_subjects joined to subjects, filtered by the student's own
   * class_id and classes.current_semester. Falls back to every semester on
   * record for the class if current_semester isn't set.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – no student with the given id
   */
  async getSubjects(id: number) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: { classes: { select: { id: true, current_semester: true } } },
    });

    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    if (!student.classes) {
      return [];
    }

    const rows = await this.prisma.class_subjects.findMany({
      where: {
        class_id: student.classes.id,
        ...(student.classes.current_semester !== null && {
          semester: student.classes.current_semester,
        }),
      },
      select: {
        semester: true,
        subjects: {
          select: { id: true, name: true, subject_code: true, credits: true },
        },
      },
      orderBy: { semester: 'asc' },
    });

    return rows.map((row) => ({
      subject_id: row.subjects.id,
      name: row.subjects.name,
      subject_code: row.subjects.subject_code,
      credits: row.subjects.credits,
      semester: row.semester,
    }));
  }

  /**
   * GET /students/:id/requests (Admin only).
   *
   * A unified view over four separate self-scoped request tables that have
   * no other shared home: student_leaves, hostel_outings, bonafide_requests,
   * od_requests (via od_team_members → od_teams). Each has its own workflow
   * and its own faculty/HoD/warden-facing review endpoint elsewhere — this
   * endpoint only reads and normalizes them for a single student's profile,
   * it doesn't touch any approval logic.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – no student with the given id
   */
  async getRequests(id: number) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const [leaves, outings, bonafides, odRequests] = await Promise.all([
      this.prisma.student_leaves.findMany({
        where: { student_id: id },
        select: {
          id: true,
          from_date: true,
          to_date: true,
          reason: true,
          status: true,
          created_at: true,
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.hostel_outings.findMany({
        where: { student_id: id },
        select: {
          id: true,
          from_date: true,
          to_date: true,
          reason: true,
          status: true,
          created_at: true,
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.bonafide_requests.findMany({
        where: { student_id: id },
        select: {
          id: true,
          requested_at: true,
          issued_at: true,
          status: true,
          bonafide_reasons: { select: { reason_text: true } },
        },
        orderBy: { requested_at: 'desc' },
      }),
      this.prisma.od_requests.findMany({
        where: { od_teams: { od_team_members: { some: { student_id: id } } } },
        select: {
          id: true,
          from_date: true,
          to_date: true,
          reason: true,
          mentor_approval_status: true,
          created_at: true,
          od_request_hod_approvals: {
            where: { student_id: id },
            select: { status: true },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    return [
      ...leaves.map((r) => ({
        type: 'leave' as const,
        id: r.id,
        label: 'Leave',
        from_date: r.from_date,
        to_date: r.to_date,
        detail: r.reason,
        status: r.status,
        created_at: r.created_at,
      })),
      ...outings.map((r) => ({
        type: 'outing' as const,
        id: r.id,
        label: 'Hostel outing',
        from_date: r.from_date,
        to_date: r.to_date,
        detail: r.reason,
        status: r.status,
        created_at: r.created_at,
      })),
      ...bonafides.map((r) => ({
        type: 'bonafide' as const,
        id: r.id,
        label: 'Bonafide certificate',
        from_date: null,
        to_date: null,
        detail: r.bonafide_reasons.reason_text,
        status: r.status,
        created_at: r.requested_at,
      })),
      ...odRequests.map((r) => ({
        type: 'od' as const,
        id: r.id,
        label: 'On-duty',
        from_date: r.from_date,
        to_date: r.to_date,
        detail: r.reason,
        status:
          r.od_request_hod_approvals[0]?.status ?? r.mentor_approval_status,
        created_at: r.created_at,
      })),
    ].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  /**
   * GET /students/:id/announcements (Admin only).
   *
   * Reuses the same visibility rule the student's own portal uses
   * (AnnouncementsService.buildVisibilityQuery, STUDENT branch) — every
   * announcement targeted at this student's current class — just resolved
   * for an explicit :id instead of the caller's own JWT.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – no student with the given id
   */
  async getAnnouncements(id: number) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: { class_id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    if (student.class_id === null) {
      return [];
    }

    return this.prisma.announcements.findMany({
      where: {
        announcement_class_mapping: { some: { class_id: student.class_id } },
      },
      select: {
        id: true,
        title: true,
        content: true,
        target_audience: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * GET /students/:id/certificates (Admin only).
   *
   * student_certificates joined to certificate_types — the admin-facing
   * CertificatesController is an unimplemented stub (nothing to build on),
   * so this reads the table directly, same as every other addition here.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – no student with the given id
   */
  async getCertificates(id: number) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const rows = await this.prisma.student_certificates.findMany({
      where: { student_id: id },
      select: {
        id: true,
        is_available: true,
        file_url: true,
        verified_at: true,
        certificate_types: { select: { name: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      certificate_name: r.certificate_types.name,
      is_available: r.is_available,
      file_url: r.file_url,
      verified_at: r.verified_at,
    }));
  }

  /**
   * GET /students/:id/transport (Admin only).
   *
   * student_transport_mapping is @unique on student_id, so this is a single
   * lookup, not a filtered list — simpler than every other addition here.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – no student with the given id
   */
  async getTransport(id: number) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const mapping = await this.prisma.student_transport_mapping.findUnique({
      where: { student_id: id },
      select: {
        transport_routes: { select: { id: true, name: true } },
        transport_stages_student_transport_mapping_boarding_stage_idTotransport_stages: {
          select: { id: true, stage_name: true, fee_amount: true },
        },
        transport_stages_student_transport_mapping_destination_stage_idTotransport_stages: {
          select: { id: true, stage_name: true },
        },
      },
    });

    if (!mapping) {
      return null;
    }

    return {
      route: mapping.transport_routes,
      boarding_stage: mapping.transport_stages_student_transport_mapping_boarding_stage_idTotransport_stages,
      destination_stage: mapping.transport_stages_student_transport_mapping_destination_stage_idTotransport_stages,
    };
  }

  /** PATCH /students/:id (Admin only) */
  async update(id: number, dto: AdminUpdateStudentDto) {
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException({
        message: 'No fields provided to update',
        errorCode: 'VALIDATION_ERROR',
      });
    }

    await this.findOne(id); // 404s consistently if missing

    const fkChecks: Array<['course_id' | 'quota_id' | 'batch_id' | 'class_id', number | undefined]> = [
      ['course_id', dto.course_id],
      ['quota_id', dto.quota_id],
      ['batch_id', dto.batch_id],
      ['class_id', dto.class_id],
    ];
    for (const [field, fkId] of fkChecks) {
      if (fkId === undefined) continue;
      const table = field === 'class_id' ? 'classes' : field.replace('_id', '') + 's';
      const exists = await (this.prisma as any)[table].findUnique({
        where: { id: fkId },
      });
      if (!exists) {
        throw new NotFoundException({
          message: `${field} not found`,
          errorCode: `${field.toUpperCase()}_NOT_FOUND`,
        });
      }
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const student = await tx.students.update({
          where: { id },
          data: {
            roll_no: dto.roll_no,
            register_no: dto.register_no,
            admission_no: dto.admission_no,
            admission_date: dto.admission_date ? new Date(dto.admission_date) : undefined,
            admission_type: dto.admission_type,
            joined_academic_year: dto.joined_academic_year,
            gender: dto.gender,
            date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : undefined,
            student_type: dto.student_type,
            dayscholar_mode: dto.dayscholar_mode,
            vehicle_number: dto.vehicle_number,
            course_id: dto.course_id,
            quota_id: dto.quota_id,
            class_id: dto.class_id,
            batch_id: dto.batch_id,
            status: dto.status,
            is_first_graduate: dto.is_first_graduate,
            nationality: dto.nationality,
            religion: dto.religion,
            community: dto.community,
            caste: dto.caste,
            mother_tongue: dto.mother_tongue,
            blood_group: dto.blood_group,
            is_father_exserviceman: dto.is_father_exserviceman,
            exserviceman_info: dto.exserviceman_info,
            is_diff_abled: dto.is_diff_abled,
            diff_abled_info: dto.diff_abled_info,
          },
          select: { id: true, user_id: true },
        });

        if (dto.status !== undefined) {
          await tx.users.update({
            where: { id: student.user_id },
            data: { status: dto.status },
          });
        }

        return student;
      }, { timeout: 20_000, maxWait: 20_000 }); // see finance-overview.service.ts getOverview() for why

      return this.findOne(updated.id);
    } catch (err) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException({
          message: 'Value already in use',
          errorCode: 'STUDENT_FIELD_CONFLICT',
        });
      }
      this.logger.error(
        `DB error updating student #${id}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /students/:id (Admin only) — soft delete.
   * Mirrors FacultyService.removeByAdmin: most FKs onto `students` are
   * onDelete: NoAction, so a hard delete throws P2003 once any activity
   * (attendance, marks, hostel, fees...) exists — which is nearly always.
   */
  async remove(id: number) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: { id: true, user_id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    await this.prisma.$transaction(
      [
        this.prisma.students.update({ where: { id }, data: { status: 'inactive' } }),
        this.prisma.users.update({
          where: { id: student.user_id },
          data: { status: 'inactive' },
        }),
      ],
      { timeout: 20_000, maxWait: 20_000 }, // see finance-overview.service.ts getOverview() for why
    );

    this.logger.log(`Student soft-deleted: id=${id}`);
    return { id, status: 'inactive' as const };
  }
}
