import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import { Prisma, address_type_enum } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { STORAGE_BUCKETS } from 'src/common/constants/storage-buckets.constant';
import { paginate } from 'src/common/dto/pagination.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { AdminUpdateStudentDto } from './dto/admin-update-student.dto';
import { AdminAttendanceSummaryQueryDto } from './dto/admin-attendance-summary-query.dto';
import { ResetStudentPasswordDto } from './dto/reset-student-password.dto';
import { UpdateStudentAddressesDto } from './dto/update-student-addresses.dto';
import { UpdateStudentContactsDto } from './dto/update-student-contacts.dto';
import { UpdateStudentFamilyDto } from './dto/update-student-family.dto';
import { UpdateStudentIdentityMarksDto } from './dto/update-student-identity-marks.dto';

const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const VALID_ADDRESS_TYPES = Object.values(address_type_enum);

/** Same charset faculty.service.ts's generateTemporaryPassword() uses — excludes visually ambiguous chars (0/O, 1/l/I). */
const TEMP_PASSWORD_CHARSET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB — same limit as the soa-applications pre-admission photo upload

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
  photo_url: true,
  photo_uploaded_at: true,
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
  student_contacts: { select: { student_mobile: true } },
} as const;

type StudentListRow = Prisma.studentsGetPayload<{
  select: typeof STUDENT_LIST_SELECT;
}>;

function toStudentDto(row: StudentListRow) {
  return {
    id: row.id,
    student_id_no: row.student_id_no,
    roll_no: row.roll_no,
    register_no: row.register_no,
    admission_no: row.admission_no,
    first_name: row.soa_applications?.first_name ?? null,
    last_name: row.soa_applications?.last_name ?? null,
    email: row.users.email,
    // users.phone is never written by the current perfect-entry endpoint —
    // the number actually captured at admission lives on student_contacts
    // instead (see students/admit wizard's "Contact record" category), so
    // it's the real fallback here rather than a second, always-null column.
    phone: row.users.phone ?? row.student_contacts?.student_mobile ?? null,
    gender: row.gender,
    date_of_birth: row.date_of_birth,
    student_type: row.student_type,
    dayscholar_mode: row.dayscholar_mode,
    status: row.status,
    admission_date: row.admission_date,
    photo_url: row.photo_url,
    photo_uploaded_at: row.photo_uploaded_at,
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** GET /students (Admin only) — paginated, searchable, filterable. */
  async findAll(query: ListStudentsQueryDto) {
    const where: Prisma.studentsWhereInput = {
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
        certificate_type_id: true,
        is_available: true,
        file_url: true,
        verified_at: true,
        certificate_types: { select: { name: true } },
      },
    });

    // student_documents is a PRIVATE bucket — file_url is stored as a
    // storage key (see StorageBuckets constant's own comment), so every
    // read needs a freshly-signed URL; the stored key is never handed to
    // the frontend directly (it isn't a browsable link on its own).
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        certificate_type_id: r.certificate_type_id,
        certificate_name: r.certificate_types.name,
        is_available: r.is_available,
        file_url: r.file_url
          ? await this.storage.getSignedDownloadUrl(
              r.file_url,
              STORAGE_BUCKETS.STUDENT_DOCUMENTS,
            )
          : null,
        verified_at: r.verified_at,
      })),
    );
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
        transport_stages_student_transport_mapping_boarding_stage_idTotransport_stages:
          {
            select: { id: true, stage_name: true, fee_amount: true },
          },
        transport_stages_student_transport_mapping_destination_stage_idTotransport_stages:
          {
            select: { id: true, stage_name: true },
          },
      },
    });

    if (!mapping) {
      return null;
    }

    return {
      route: mapping.transport_routes,
      boarding_stage:
        mapping.transport_stages_student_transport_mapping_boarding_stage_idTotransport_stages,
      destination_stage:
        mapping.transport_stages_student_transport_mapping_destination_stage_idTotransport_stages,
    };
  }

  /**
   * GET /students/:id/medical — `medical_visits.student_id` is nullable
   * because the same table also logs faculty visits (`visitor_type`
   * discriminates); scoping to this student's rows is enough, no extra
   * `visitor_type` filter needed since a row can only carry one FK.
   */
  async getMedicalVisits(id: number) {
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

    const visits = await this.prisma.medical_visits.findMany({
      where: { student_id: id },
      select: {
        id: true,
        visit_date: true,
        reason: true,
        diagnosis: true,
        treatment_given: true,
        referred_to_hospital: true,
        medical_staff: { select: { name: true, designation: true } },
      },
      orderBy: { visit_date: 'desc' },
    });

    return visits.map((v) => ({
      id: v.id,
      visit_date: v.visit_date,
      reason: v.reason,
      diagnosis: v.diagnosis,
      treatment_given: v.treatment_given,
      referred_to_hospital: v.referred_to_hospital,
      attended_by: v.medical_staff,
    }));
  }

  /** PATCH /students/:id (Admin only) */
  /**
   * GET /students/:id/edit-profile — mirrors AdminUpdateStudentDto's field
   * list exactly, so the admin "Edit profile" form always shows the real
   * current value of every field it's about to let someone overwrite.
   * Deliberately separate from STUDENT_LIST_SELECT/toStudentDto (used by the
   * paginated list too) rather than widening that shared select with a dozen
   * edit-only columns it doesn't need. `addresses` is the one relation
   * included here — the Edit Profile modal's Addresses section reads it
   * directly rather than the modal doing a second fetch against
   * getProfileDetails just for this one field.
   */
  async getEditProfile(id: number) {
    const row = await this.prisma.students.findUnique({
      where: { id },
      select: {
        roll_no: true,
        register_no: true,
        admission_no: true,
        admission_date: true,
        admission_type: true,
        joined_academic_year: true,
        gender: true,
        date_of_birth: true,
        student_type: true,
        dayscholar_mode: true,
        vehicle_number: true,
        course_id: true,
        quota_id: true,
        class_id: true,
        batch_id: true,
        status: true,
        is_first_graduate: true,
        nationality: true,
        religion: true,
        community: true,
        caste: true,
        mother_tongue: true,
        blood_group: true,
        is_father_exserviceman: true,
        exserviceman_info: true,
        is_diff_abled: true,
        diff_abled_info: true,
        photo_url: true,
        student_addresses: {
          select: {
            address_type: true,
            address_line: true,
            city: true,
            state: true,
            pincode: true,
          },
        },
        soa_applications: { select: { first_name: true, last_name: true } },
        student_contacts: {
          select: {
            student_email1: true,
            student_email2: true,
            student_mobile: true,
          },
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
        student_identity_marks: {
          select: { mark_number: true, description: true },
          orderBy: { mark_number: 'asc' },
        },
      },
    });
    if (!row) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    const {
      student_addresses,
      soa_applications,
      student_contacts,
      student_family_details,
      student_identity_marks,
      ...rest
    } = row;
    return {
      ...rest,
      first_name: soa_applications?.first_name ?? null,
      last_name: soa_applications?.last_name ?? null,
      addresses: student_addresses,
      contacts: student_contacts,
      family: student_family_details,
      identity_marks: student_identity_marks,
    };
  }

  /**
   * PATCH /students/:id/addresses (Admin only) — upserts one or both
   * addresses by (student_id, address_type). This is the only way to fix an
   * address after admission: perfect-entry's own address fields (see
   * SoaApplicationsService.perfectEntry) can only ever be set once, at
   * creation — see UpdateStudentAddressesDto's own docblock.
   *
   * Error responses:
   *  400 VALIDATION_ERROR       – addresses repeats the same address_type
   *  404 STUDENT_NOT_FOUND
   *  422 INVALID_ADDRESS_TYPE   – address_type isn't permanent/temporary
   */
  async updateAddresses(id: number, dto: UpdateStudentAddressesDto) {
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

    const types = dto.addresses.map((a) => a.address_type);
    if (new Set(types).size !== types.length) {
      throw new BadRequestException({
        message: 'addresses cannot repeat the same address_type',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    for (const address of dto.addresses) {
      if (
        !VALID_ADDRESS_TYPES.includes(address.address_type as address_type_enum)
      ) {
        throw new UnprocessableEntityException({
          message: `address_type must be one of: ${VALID_ADDRESS_TYPES.join(', ')}`,
          errorCode: 'INVALID_ADDRESS_TYPE',
        });
      }
    }

    await this.prisma.$transaction(
      dto.addresses.map((address) => {
        const addressType = address.address_type as address_type_enum;
        return this.prisma.student_addresses.upsert({
          where: {
            student_id_address_type: {
              student_id: id,
              address_type: addressType,
            },
          },
          create: {
            student_id: id,
            address_type: addressType,
            address_line: address.address_line,
            city: address.city,
            state: address.state,
            pincode: address.pincode,
          },
          update: {
            address_line: address.address_line,
            city: address.city,
            state: address.state,
            pincode: address.pincode,
          },
        });
      }),
    );

    const rows = await this.prisma.student_addresses.findMany({
      where: { student_id: id },
      select: {
        address_type: true,
        address_line: true,
        city: true,
        state: true,
        pincode: true,
      },
    });
    return { addresses: rows };
  }

  /**
   * PATCH /students/:id/contacts (Admin only) — upserts by student_id, same
   * "fix it after admission" role addresses/family details fill for their
   * own tables. Omitted fields are left unchanged, not cleared — a blank
   * value has to be sent explicitly (empty string) to clear one.
   */
  async updateContacts(id: number, dto: UpdateStudentContactsDto) {
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

    return this.prisma.student_contacts.upsert({
      where: { student_id: id },
      create: {
        student_id: id,
        student_email1: dto.student_email1,
        student_email2: dto.student_email2,
        student_mobile: dto.student_mobile,
      },
      update: {
        student_email1: dto.student_email1,
        student_email2: dto.student_email2,
        student_mobile: dto.student_mobile,
      },
      select: {
        student_email1: true,
        student_email2: true,
        student_mobile: true,
      },
    });
  }

  /**
   * PATCH /students/:id/family (Admin only) — upserts by student_id. See
   * UpdateStudentFamilyDto's own docblock for what this deliberately
   * doesn't touch (guardian_* columns — not read anywhere on the profile
   * page either).
   */
  async updateFamily(id: number, dto: UpdateStudentFamilyDto) {
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

    const data = {
      father_name: dto.father_name,
      father_qualification: dto.father_qualification,
      father_occupation: dto.father_occupation,
      father_annual_income: dto.father_annual_income,
      father_email: dto.father_email,
      father_mobile: dto.father_mobile,
      mother_name: dto.mother_name,
      mother_qualification: dto.mother_qualification,
      mother_occupation: dto.mother_occupation,
      mother_annual_income: dto.mother_annual_income,
      mother_email: dto.mother_email,
      mother_mobile: dto.mother_mobile,
    };

    return this.prisma.student_family_details.upsert({
      where: { student_id: id },
      create: { student_id: id, ...data },
      update: data,
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
    });
  }

  /**
   * PATCH /students/:id/identity-marks (Admin only) — replaces the whole
   * set every save (see UpdateStudentIdentityMarksDto's own docblock for
   * why this can't just be an upsert-in-place like addresses/family: the
   * list length itself changes, so there's no fixed set of keys to upsert
   * against). Deletes every existing mark for this student, then recreates
   * whatever was sent — inside one transaction, so a failure partway
   * through never leaves the student with a half-replaced list.
   */
  async updateIdentityMarks(id: number, dto: UpdateStudentIdentityMarksDto) {
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

    const marks = dto.identity_marks.map((m) => m.mark_number);
    if (new Set(marks).size !== marks.length) {
      throw new BadRequestException({
        message: 'identity_marks cannot repeat the same mark_number',
        errorCode: 'VALIDATION_ERROR',
      });
    }

    await this.prisma.$transaction([
      this.prisma.student_identity_marks.deleteMany({
        where: { student_id: id },
      }),
      ...(dto.identity_marks.length > 0
        ? [
            this.prisma.student_identity_marks.createMany({
              data: dto.identity_marks.map((m) => ({
                student_id: id,
                mark_number: m.mark_number,
                description: m.description,
              })),
            }),
          ]
        : []),
    ]);

    return this.prisma.student_identity_marks.findMany({
      where: { student_id: id },
      select: { mark_number: true, description: true },
      orderBy: { mark_number: 'asc' },
    });
  }

  /**
   * POST /students/:id/photo (Admin only) — change/replace an existing
   * student's photo. Deletes the previous storage object (best-effort — a
   * failure there shouldn't block the new photo from being saved) when
   * replacing one that was uploaded through this same endpoint.
   */
  async uploadPhoto(id: number, file: Express.Multer.File) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: { id: true, photo_url: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    if (!PHOTO_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        message: `That file type is not accepted. JPG, PNG or WebP only — got ${file.mimetype || 'an unknown type'}.`,
        errorCode: 'INVALID_PHOTO_TYPE',
      });
    }
    if (file.size > PHOTO_MAX_BYTES) {
      throw new BadRequestException({
        message: `File is too large — the limit is ${PHOTO_MAX_BYTES / (1024 * 1024)}MB.`,
        errorCode: 'PHOTO_TOO_LARGE',
      });
    }

    const { key } = await this.storage.upload(
      `students/${id}`,
      file.originalname,
      file.buffer,
      file.mimetype,
      STORAGE_BUCKETS.STUDENT_PHOTOS,
    );
    const photoUrl = this.storage.getPublicUrl(
      key,
      STORAGE_BUCKETS.STUDENT_PHOTOS,
    );

    const oldKey = this.extractStorageKey(
      student.photo_url,
      STORAGE_BUCKETS.STUDENT_PHOTOS,
    );

    const updated = await this.prisma.students.update({
      where: { id },
      data: { photo_url: photoUrl, photo_uploaded_at: new Date() },
      select: { photo_url: true, photo_uploaded_at: true },
    });

    if (oldKey) {
      try {
        await this.storage.delete(oldKey, STORAGE_BUCKETS.STUDENT_PHOTOS);
      } catch (err) {
        this.logger.warn(
          `Old photo cleanup failed for student ${id} (new photo already saved): ${err}`,
        );
      }
    }

    return updated;
  }

  /** Reverses getPublicUrl()'s construction — null on any URL that doesn't match this bucket's public-URL shape (nothing to delete, not an error). */
  private extractStorageKey(url: string | null, bucket: string): string | null {
    if (!url) return null;
    const marker = `/storage/v1/object/public/${bucket}/`;
    const index = url.indexOf(marker);
    return index === -1 ? null : url.slice(index + marker.length);
  }

  /**
   * DELETE /students/:id/photo (Admin only) — removes the student's photo:
   * storage object cleanup is best-effort (a failure there shouldn't block
   * the DB from reflecting "no photo"), then photo_url/photo_uploaded_at are
   * cleared. Calling this when there's already no photo is a no-op, not an
   * error — same idempotent-delete convention as the rest of this module.
   */
  async deletePhoto(id: number) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: { id: true, photo_url: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const key = this.extractStorageKey(
      student.photo_url,
      STORAGE_BUCKETS.STUDENT_PHOTOS,
    );
    if (key) {
      try {
        await this.storage.delete(key, STORAGE_BUCKETS.STUDENT_PHOTOS);
      } catch (err) {
        this.logger.warn(
          `Photo storage cleanup failed for student ${id} (DB will still be cleared): ${err}`,
        );
      }
    }

    return this.prisma.students.update({
      where: { id },
      data: { photo_url: null, photo_uploaded_at: null },
      select: { photo_url: true, photo_uploaded_at: true },
    });
  }

  /**
   * POST /students/:id/reset-password (Admin only) — for a student who
   * forgot their password (there's no self-service reset yet — see
   * SoaApplicationsService.perfectEntry's own comment on why there's still
   * no email/SMS delivery mechanism). Provide `password` to set it exactly,
   * or omit it to get a random one generated — either way the plaintext is
   * returned once so the admin can hand it to the student directly; nothing
   * retrievable is stored (password_hash is one-way, same scheme as login).
   */
  async resetPassword(
    id: number,
    dto: ResetStudentPasswordDto,
    adminUserId: number,
  ) {
    // Step-up confirmation: the calling admin must re-prove their own
    // identity with their own current password before this runs, even
    // though the route is already behind JwtAuthGuard + RolesGuard — that
    // only proves the session is an admin's, not that the person at the
    // keyboard right now is (an unattended/logged-in session shouldn't be
    // enough to pull a student's new credentials).
    //
    // 403, not 401: the JWT itself is still perfectly valid — this is an
    // authorization failure on this one action, not an authentication
    // failure. The frontend's query client treats every 401 as "the
    // session died" and force-logs-out to /login (see query-client.ts's
    // onError) — a wrong confirmation password here must never trigger that.
    const admin = await this.prisma.users.findUnique({
      where: { id: adminUserId },
      select: { password_hash: true },
    });
    if (
      !admin ||
      this.hashPassword(dto.adminPassword) !== admin.password_hash
    ) {
      throw new ForbiddenException({
        message: 'Incorrect password',
        errorCode: 'ADMIN_PASSWORD_INCORRECT',
      });
    }

    const student = await this.prisma.students.findUnique({
      where: { id },
      select: { user_id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const newPassword = dto.password ?? this.generateTemporaryPassword();
    const passwordHash = this.hashPassword(newPassword);

    await this.prisma.users.update({
      where: { id: student.user_id },
      data: { password_hash: passwordHash },
    });

    return { password: newPassword };
  }

  /** Same one-way SHA-256 hashing scheme used by AuthService's login check and SoaApplicationsService's perfectEntry(). */
  private hashPassword(plain: string): string {
    return crypto.createHash('sha256').update(plain).digest('hex');
  }

  /** Same generator faculty.service.ts uses for its own temporary passwords. */
  private generateTemporaryPassword(): string {
    const bytes = crypto.randomBytes(10);
    let password = '';
    for (const byte of bytes) {
      password += TEMP_PASSWORD_CHARSET[byte % TEMP_PASSWORD_CHARSET.length];
    }
    return `${password}@1`;
  }

  async update(id: number, dto: AdminUpdateStudentDto) {
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException({
        message: 'No fields provided to update',
        errorCode: 'VALIDATION_ERROR',
      });
    }

    await this.findOne(id); // 404s consistently if missing

    const fkFinders: Record<
      'course_id' | 'quota_id' | 'batch_id' | 'class_id',
      (fkId: number) => Promise<{ id: number } | null>
    > = {
      course_id: (fkId) =>
        this.prisma.courses.findUnique({ where: { id: fkId } }),
      quota_id: (fkId) =>
        this.prisma.quotas.findUnique({ where: { id: fkId } }),
      batch_id: (fkId) =>
        this.prisma.batches.findUnique({ where: { id: fkId } }),
      class_id: (fkId) =>
        this.prisma.classes.findUnique({ where: { id: fkId } }),
    };
    const fkChecks: Array<
      ['course_id' | 'quota_id' | 'batch_id' | 'class_id', number | undefined]
    > = [
      ['course_id', dto.course_id],
      ['quota_id', dto.quota_id],
      ['batch_id', dto.batch_id],
      ['class_id', dto.class_id],
    ];
    for (const [field, fkId] of fkChecks) {
      if (fkId === undefined) continue;
      const exists = await fkFinders[field](fkId);
      if (!exists) {
        throw new NotFoundException({
          message: `${field} not found`,
          errorCode: `${field.toUpperCase()}_NOT_FOUND`,
        });
      }
    }

    try {
      const updated = await this.prisma.$transaction(
        async (tx) => {
          const student = await tx.students.update({
            where: { id },
            data: {
              roll_no: dto.roll_no,
              register_no: dto.register_no,
              admission_no: dto.admission_no,
              admission_date: dto.admission_date
                ? new Date(dto.admission_date)
                : undefined,
              admission_type: dto.admission_type,
              joined_academic_year: dto.joined_academic_year,
              gender: dto.gender,
              date_of_birth: dto.date_of_birth
                ? new Date(dto.date_of_birth)
                : undefined,
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
            select: { id: true, user_id: true, soa_application_id: true },
          });

          if (dto.status !== undefined) {
            await tx.users.update({
              where: { id: student.user_id },
              data: { status: dto.status },
            });
          }

          // first_name/last_name live on the linked soa_applications row,
          // not on students itself (see this DTO's own docblock). Every
          // student is created from an application (SoaApplicationsService's
          // perfectEntry flow), so soa_application_id is only null in
          // practice for data that predates that invariant — fail loudly
          // rather than silently drop a rename for that record.
          if (dto.first_name !== undefined || dto.last_name !== undefined) {
            if (!student.soa_application_id) {
              throw new UnprocessableEntityException({
                message:
                  "This student has no linked application record to rename — its name can't be edited here",
                errorCode: 'NO_LINKED_APPLICATION',
              });
            }
            await tx.soa_applications.update({
              where: { id: student.soa_application_id },
              data: { first_name: dto.first_name, last_name: dto.last_name },
            });
          }

          return student;
        },
        { timeout: 20_000, maxWait: 20_000 },
      ); // see finance-overview.service.ts getOverview() for why

      return this.findOne(updated.id);
    } catch (err) {
      // A deliberate exception thrown from inside the transaction above
      // (NO_LINKED_APPLICATION) — rethrow as-is, don't let the generic
      // P2002/500 handling below relabel it as an opaque server error.
      if (err instanceof UnprocessableEntityException) {
        throw err;
      }
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
        this.prisma.students.update({
          where: { id },
          data: { status: 'inactive' },
        }),
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
