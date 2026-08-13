import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const MENTEE_PLACEMENT_SELECT = {
  id: true,
  status: true,
  updated_at: true,
  placement_drives: {
    select: {
      id: true,
      is_disclosed: true,
      disclosed_reveal_date: true,
      scheduled_date: true,
      companies: { select: { name: true } },
    },
  },
} as const;

interface MenteePlacementRow {
  id: number;
  status: string;
  updated_at: Date;
  placement_drives: {
    id: number;
    is_disclosed: boolean;
    disclosed_reveal_date: Date | null;
    scheduled_date: Date;
    companies: { name: string };
  };
}

/**
 * placement_drives.is_disclosed defaults true (most drives are named openly).
 * disclosed_reveal_date only matters when is_disclosed is false — it's the
 * scheduled auto-reveal date for a drive that started out undisclosed. Once
 * that date has passed, the company becomes visible even though is_disclosed
 * itself was never flipped to true.
 */
function isEffectivelyDisclosed(
  drive: MenteePlacementRow['placement_drives'],
): boolean {
  if (drive.is_disclosed) {
    return true;
  }
  return (
    drive.disclosed_reveal_date !== null &&
    drive.disclosed_reveal_date <= new Date()
  );
}

function toPlacementResponse(application: MenteePlacementRow) {
  const disclosed = isEffectivelyDisclosed(application.placement_drives);
  return {
    drive_id: application.placement_drives.id,
    company_name: disclosed
      ? application.placement_drives.companies.name
      : null,
    is_disclosed: disclosed,
    scheduled_date: application.placement_drives.scheduled_date,
    application_status: application.status,
    updated_at: application.updated_at,
  };
}

const MENTEE_PROFILE_SELECT = {
  id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
  admission_no: true,
  class_id: true,
  gender: true,
  date_of_birth: true,
  student_type: true,
  dayscholar_mode: true,
  vehicle_number: true,
  nationality: true,
  religion: true,
  community: true,
  caste: true,
  mother_tongue: true,
  blood_group: true,
  is_first_graduate: true,
  is_father_exserviceman: true,
  exserviceman_info: true,
  is_diff_abled: true,
  diff_abled_info: true,
  courses: { select: { id: true, name: true, code: true } },
  quotas: { select: { id: true, name: true } },
  classes: {
    select: {
      id: true,
      section: true,
      departments: { select: { id: true, name: true, code: true } },
    },
  },
  batches: {
    select: { id: true, name: true, start_year: true, end_year: true },
  },
  soa_applications: { select: { first_name: true, last_name: true } },
  users: { select: { id: true, email: true, phone: true } },
  student_addresses: {
    select: {
      id: true,
      address_type: true,
      address_line: true,
      city: true,
      state: true,
      pincode: true,
    },
  },
  student_identity_marks: {
    select: { id: true, mark_number: true, description: true },
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
  student_profiles: {
    select: {
      resume_url: true,
      linkedin_url: true,
      github_url: true,
      leetcode_url: true,
      hackerrank_url: true,
      codeforces_url: true,
    },
  },
  student_projects: {
    select: { id: true, title: true, description: true },
  },
} as const;

interface MenteeProfileRow {
  id: number;
  student_id_no: string;
  roll_no: string | null;
  register_no: string | null;
  admission_no: string | null;
  class_id: number | null;
  gender: string | null;
  date_of_birth: Date | null;
  student_type: string;
  dayscholar_mode: string | null;
  vehicle_number: string | null;
  nationality: string | null;
  religion: string | null;
  community: string | null;
  caste: string | null;
  mother_tongue: string | null;
  blood_group: string | null;
  is_first_graduate: boolean;
  is_father_exserviceman: boolean;
  exserviceman_info: string | null;
  is_diff_abled: boolean;
  diff_abled_info: string | null;
  courses: { id: number; name: string; code: string };
  quotas: { id: number; name: string };
  classes: {
    id: number;
    section: string;
    departments: { id: number; name: string; code: string };
  } | null;
  batches: { id: number; name: string; start_year: number; end_year: number };
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { id: number; email: string; phone: string | null };
  student_addresses: {
    id: number;
    address_type: string;
    address_line: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  }[];
  student_identity_marks: {
    id: number;
    mark_number: number;
    description: string | null;
  }[];
  student_family_details: {
    father_name: string | null;
    father_qualification: string | null;
    father_occupation: string | null;
    father_annual_income: unknown;
    father_email: string | null;
    father_mobile: string | null;
    mother_name: string | null;
    mother_qualification: string | null;
    mother_occupation: string | null;
    mother_annual_income: unknown;
    mother_email: string | null;
    mother_mobile: string | null;
  } | null;
  student_contacts: {
    student_email1: string | null;
    student_email2: string | null;
    student_mobile: string | null;
  } | null;
  student_profiles: {
    resume_url: string | null;
    linkedin_url: string | null;
    github_url: string | null;
    leetcode_url: string | null;
    hackerrank_url: string | null;
    codeforces_url: string | null;
  } | null;
  student_projects: {
    id: number;
    title: string;
    description: string | null;
  }[];
}

interface NamedStudent {
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
}

function resolveStudentName(student: NamedStudent): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

/**
 * GET /me/mentees/:student_id/report — the fields workflow.md's Faculty
 * "Generate certain reports" line actually asks for: name, official email
 * (the college-issued login, `users.email`), unofficial email(s) + mobile
 * (`student_contacts`), parents' names/numbers (`student_family_details`),
 * and Aadhar/PAN (`student_sensitive_info`). Deliberately a SEPARATE select
 * from MENTEE_PROFILE_SELECT above, which intentionally excludes
 * student_sensitive_info — this is the one legitimate, narrowly-scoped path
 * to that data, not a backdoor into the general profile view.
 */
const MENTEE_REPORT_SELECT = {
  id: true,
  student_id_no: true,
  class_id: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  users: { select: { email: true } },
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
      father_mobile: true,
      father_email: true,
      mother_name: true,
      mother_mobile: true,
      mother_email: true,
    },
  },
  student_sensitive_info: {
    select: { aadhar_number: true, pan_number: true },
  },
} as const;

interface MenteeReportRow {
  id: number;
  student_id_no: string;
  class_id: number | null;
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
  student_contacts: {
    student_email1: string | null;
    student_email2: string | null;
    student_mobile: string | null;
  } | null;
  student_family_details: {
    father_name: string | null;
    father_mobile: string | null;
    father_email: string | null;
    mother_name: string | null;
    mother_mobile: string | null;
    mother_email: string | null;
  } | null;
  student_sensitive_info: {
    aadhar_number: string | null;
    pan_number: string | null;
  } | null;
}

function toReportResponse(student: MenteeReportRow) {
  return {
    id: student.id,
    student_id_no: student.student_id_no,
    name: resolveStudentName(student),
    official_email: student.users.email,
    unofficial_email: student.student_contacts?.student_email1 ?? null,
    unofficial_email_alt: student.student_contacts?.student_email2 ?? null,
    student_mobile: student.student_contacts?.student_mobile ?? null,
    father: {
      name: student.student_family_details?.father_name ?? null,
      mobile: student.student_family_details?.father_mobile ?? null,
      email: student.student_family_details?.father_email ?? null,
    },
    mother: {
      name: student.student_family_details?.mother_name ?? null,
      mobile: student.student_family_details?.mother_mobile ?? null,
      email: student.student_family_details?.mother_email ?? null,
    },
    aadhar_number: student.student_sensitive_info?.aadhar_number ?? null,
    pan_number: student.student_sensitive_info?.pan_number ?? null,
  };
}

function toResponse(student: MenteeProfileRow) {
  return {
    id: student.id,
    name: resolveStudentName(student),
    student_id_no: student.student_id_no,
    roll_no: student.roll_no,
    register_no: student.register_no,
    admission_no: student.admission_no,
    email: student.users.email,
    phone: student.users.phone,
    gender: student.gender,
    date_of_birth: student.date_of_birth,
    student_type: student.student_type,
    dayscholar_mode: student.dayscholar_mode,
    vehicle_number: student.vehicle_number,
    nationality: student.nationality,
    religion: student.religion,
    community: student.community,
    caste: student.caste,
    mother_tongue: student.mother_tongue,
    blood_group: student.blood_group,
    is_first_graduate: student.is_first_graduate,
    is_father_exserviceman: student.is_father_exserviceman,
    exserviceman_info: student.exserviceman_info,
    is_diff_abled: student.is_diff_abled,
    diff_abled_info: student.diff_abled_info,
    course: student.courses,
    quota: student.quotas,
    class: student.classes
      ? {
          id: student.classes.id,
          section: student.classes.section,
          department: student.classes.departments,
        }
      : null,
    batch: student.batches,
    addresses: student.student_addresses,
    identity_marks: student.student_identity_marks,
    family_details: student.student_family_details,
    contacts: student.student_contacts,
    profile_links: student.student_profiles,
    projects: student.student_projects,
  };
}

const MENTEE_CLASS_STUDENT_SELECT = {
  id: true,
  student_id_no: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  users: { select: { email: true } },
} as const;

interface MenteeClassRow {
  class_id: number;
  academic_year: string;
  classes: {
    id: number;
    section: string;
    departments: { id: number; name: string; code: string };
    courses: { code: string } | null;
    batches: { name: string };
    students: {
      id: number;
      student_id_no: string;
      soa_applications: { first_name: string; last_name: string | null } | null;
      users: { email: string };
    }[];
  };
}

interface ClassLabelInput {
  section: string;
  departments: { code: string };
  courses: { code: string } | null;
  batches: { name: string };
}

function classLabel(klass: ClassLabelInput): string {
  const courseCode = klass.courses?.code ?? klass.departments.code;
  return `${courseCode}-${klass.section} (${klass.batches.name})`;
}

function toMenteeClassResponse(row: MenteeClassRow) {
  return {
    class_id: row.classes.id,
    label: classLabel(row.classes),
    section: row.classes.section,
    department: row.classes.departments,
    academic_year: row.academic_year,
    students: row.classes.students.map((student) => ({
      id: student.id,
      student_id_no: student.student_id_no,
      name: resolveStudentName(student),
    })),
  };
}

// Anna University-style absolute grading bands, same convention already
// used for the "Subject Records" feature (subject-records.service.ts) -
// there is no stored letter-grade column anywhere, so this is re-derived
// from marks_obtained/max_marks here too.
const GRADE_POINTS: { min: number; point: number }[] = [
  { min: 91, point: 10 }, // O
  { min: 81, point: 9 }, // A+
  { min: 71, point: 8 }, // A
  { min: 61, point: 7 }, // B+
  { min: 50, point: 6 }, // B
  { min: 0, point: 0 }, // RA (arrear)
];

function gradePointForPercentage(percentage: number): number {
  const band = GRADE_POINTS.find((b) => percentage >= b.min);
  return band ? band.point : 0;
}

interface ClassResultStudentRow {
  id: number;
  student_id_no: string;
  roll_no: string | null;
  register_no: string | null;
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
  student_family_details: {
    father_name: string | null;
    father_mobile: string | null;
    mother_name: string | null;
    mother_mobile: string | null;
  } | null;
  student_contacts: { student_mobile: string | null } | null;
}

function resolveGuardian(student: ClassResultStudentRow): {
  guardian_name: string | null;
  guardian_relation: 'Father' | 'Mother' | null;
} {
  const family = student.student_family_details;
  if (family?.father_name) {
    return { guardian_name: family.father_name, guardian_relation: 'Father' };
  }
  if (family?.mother_name) {
    return { guardian_name: family.mother_name, guardian_relation: 'Mother' };
  }
  return { guardian_name: null, guardian_relation: null };
}

function resolveContact(student: ClassResultStudentRow): string | null {
  const family = student.student_family_details;
  return (
    student.student_contacts?.student_mobile ??
    family?.father_mobile ??
    family?.mother_mobile ??
    null
  );
}

@Injectable()
export class ClassMentorsService {
  private readonly logger = new Logger(ClassMentorsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/mentee-classes (Faculty only).
   *
   * Not part of the original doc set — added to close a real gap: without
   * this, a mentor has no way to discover which students they mentor at
   * all; getMenteeProfile/getMenteePlacements both require already knowing
   * a student_id.
   */
  async getMenteeClasses(userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const rows = await this.prisma.class_mentors.findMany({
      where: { faculty_id: faculty.id },
      orderBy: { academic_year: 'desc' },
      select: {
        class_id: true,
        academic_year: true,
        classes: {
          select: {
            id: true,
            section: true,
            departments: { select: { id: true, name: true, code: true } },
            courses: { select: { code: true } },
            batches: { select: { name: true } },
            students: { select: MENTEE_CLASS_STUDENT_SELECT },
          },
        },
      },
    });

    return rows.map(toMenteeClassResponse);
  }

  /**
   * GET /me/mentee-classes/:class_id/students (Faculty — mentor of this
   * class only, via class_mentors).
   *
   * Powers the "Class Result" screen: full roster + per-student attendance
   * %, CGPA and arrears. Neither CGPA nor "arrears" exist as stored columns
   * anywhere in the schema (confirmed: no cgpa/arrear/backlog model) - both
   * are derived here from exam_marks the same way Subject Records derives
   * its grade distribution (marks_obtained/max_marks -> Anna University
   * absolute-grading bands), weighted by subjects.credits where set
   * (default 1 for subjects with no credits configured). This is a
   * best-effort approximation over whatever exam_marks rows exist for the
   * student across every exam they have marks in - not a substitute for an
   * official semester result computation, which this schema has no model for.
   */
  async getMenteeClassResult(classId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mentorMapping = await this.prisma.class_mentors.findFirst({
      where: { class_id: classId, faculty_id: faculty.id },
      orderBy: { id: 'desc' },
      select: {
        academic_year: true,
        faculty: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    if (!mentorMapping) {
      throw new ForbiddenException({
        message: 'You are not the mentor for this class',
        errorCode: 'NOT_THE_MENTOR',
      });
    }

    const klass = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: {
        id: true,
        section: true,
        departments: { select: { id: true, name: true, code: true } },
        courses: { select: { code: true } },
        batches: { select: { name: true } },
      },
    });
    if (!klass) {
      throw new NotFoundException({
        message: 'Class not found',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    const students = await this.prisma.students.findMany({
      where: { class_id: classId },
      orderBy: { roll_no: 'asc' },
      select: {
        id: true,
        student_id_no: true,
        roll_no: true,
        register_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
        student_family_details: {
          select: {
            father_name: true,
            father_mobile: true,
            mother_name: true,
            mother_mobile: true,
          },
        },
        student_contacts: { select: { student_mobile: true } },
      },
    });
    const studentIds = students.map((s) => s.id);

    const [attendanceRecords, marks] = await Promise.all([
      this.prisma.attendance_records.findMany({
        where: { student_id: { in: studentIds } },
        select: { student_id: true, status: true },
      }),
      this.prisma.exam_marks.findMany({
        where: {
          student_id: { in: studentIds },
          marks_obtained: { not: null },
        },
        select: {
          student_id: true,
          marks_obtained: true,
          max_marks: true,
          exam_subject_mapping: {
            select: { subjects: { select: { credits: true } } },
          },
        },
      }),
    ]);

    const attendanceByStudent = new Map<
      number,
      { total: number; present: number }
    >();
    for (const record of attendanceRecords) {
      const entry = attendanceByStudent.get(record.student_id) ?? {
        total: 0,
        present: 0,
      };
      entry.total += 1;
      if (record.status === 'present') entry.present += 1;
      attendanceByStudent.set(record.student_id, entry);
    }

    const resultByStudent = new Map<
      number,
      { weightedPoints: number; totalCredits: number; arrears: number }
    >();
    for (const mark of marks) {
      const entry = resultByStudent.get(mark.student_id) ?? {
        weightedPoints: 0,
        totalCredits: 0,
        arrears: 0,
      };
      const obtained = Number(mark.marks_obtained);
      const max = Number(mark.max_marks);
      const percentage = max > 0 ? (obtained / max) * 100 : 0;
      const credits = mark.exam_subject_mapping.subjects.credits ?? 1;
      const gradePoint = gradePointForPercentage(percentage);

      entry.weightedPoints += gradePoint * credits;
      entry.totalCredits += credits;
      if (gradePoint === 0) entry.arrears += 1;
      resultByStudent.set(mark.student_id, entry);
    }

    const mentorName = `${mentorMapping.faculty.first_name} ${mentorMapping.faculty.last_name}`;

    return {
      class: { id: klass.id, label: classLabel(klass) },
      department: klass.departments,
      academic_year: mentorMapping.academic_year,
      mentor: { id: mentorMapping.faculty.id, name: mentorName },
      students: students.map((student) => {
        const attendance = attendanceByStudent.get(student.id);
        const result = resultByStudent.get(student.id);
        const { guardian_name, guardian_relation } = resolveGuardian(student);

        return {
          id: student.id,
          name: resolveStudentName(student),
          student_id_no: student.student_id_no,
          roll_no: student.roll_no,
          register_no: student.register_no,
          attendance_percent: attendance
            ? Math.round((attendance.present / attendance.total) * 10000) / 100
            : null,
          cgpa: result && result.totalCredits > 0
            ? Math.round((result.weightedPoints / result.totalCredits) * 100) / 100
            : null,
          arrears: result?.arrears ?? 0,
          mentor_name: mentorName,
          guardian_name,
          guardian_relation,
          contact: resolveContact(student),
        };
      }),
    };
  }

  /**
   * GET /me/mentees/:student_id/profile (Faculty — the mentee's class
   * mentor only, via class_mentors).
   *
   * workflow.md (Faculty role): "can view students profile that contains
   * their resume, their projects, linkedin, github, leetcode, hackerrank,
   * codeforces etc.. mapped as mentor to the faculty" — student_profiles
   * (resume_url/linkedin_url/github_url/leetcode_url/hackerrank_url/
   * codeforces_url, exposed as `profile_links`) and student_projects
   * (exposed as `projects`) are the two tables that line is actually about;
   * both were missing from an earlier version of this select. Same field
   * set otherwise as the (not yet built) student-facing GET /me/profile:
   * students core + courses/quotas/classes/batches +
   * student_addresses/student_identity_marks/student_family_details/
   * student_contacts. student_sensitive_info (Aadhar/PAN) is never selected —
   * that's a distinct, intentionally narrower gap (see workflow.md's faculty
   * "student reports" line, which is unimplemented specifically because it
   * would need its own explicitly-audited endpoint, not folded in here).
   *
   * One query fetches the full profile (including class_id) first, then the
   * mentor-scope check runs against that — cheaper than two sequential
   * student lookups, without changing the observable behavior.
   */
  async getMenteeProfile(studentId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: MENTEE_PROFILE_SELECT,
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const mentorMapping =
      student.class_id !== null
        ? await this.prisma.class_mentors.findFirst({
            where: { class_id: student.class_id, faculty_id: faculty.id },
          })
        : null;
    if (!mentorMapping) {
      throw new ForbiddenException({
        message: 'You are not the mentor for this student',
        errorCode: 'NOT_THE_MENTOR',
      });
    }

    return toResponse(student);
  }

  /**
   * GET /me/mentees/:student_id/report (Faculty — the mentee's class mentor
   * only, via class_mentors — same gate as getMenteeProfile).
   *
   * workflow.md (Faculty role): "Generate certain reports like student
   * information with name, parents name, number, parents number, mail id
   * (official and unofficial), aadhar details and pan card details."
   * Deliberately a separate endpoint from getMenteeProfile, not an
   * extension of it — that endpoint intentionally excludes
   * student_sensitive_info; this one exists specifically to be the single,
   * narrowly-scoped, logged path to Aadhar/PAN, gated by the identical
   * mentor check rather than any broader "any faculty" access.
   */
  async getMenteeReport(studentId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: MENTEE_REPORT_SELECT,
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const mentorMapping =
      student.class_id !== null
        ? await this.prisma.class_mentors.findFirst({
            where: { class_id: student.class_id, faculty_id: faculty.id },
          })
        : null;
    if (!mentorMapping) {
      throw new ForbiddenException({
        message: 'You are not the mentor for this student',
        errorCode: 'NOT_THE_MENTOR',
      });
    }

    this.logger.log(
      `Sensitive student report accessed: student=${studentId} by faculty=${faculty.id}`,
    );
    return toReportResponse(student);
  }

  /**
   * GET /me/mentees/:student_id/placements (Faculty — the mentee's class
   * mentor only, via class_mentors — same gate as getMenteeProfile above).
   *
   * Applies the same is_disclosed/disclosed_reveal_date substitution the
   * student-facing placements view would use (not yet built elsewhere in
   * this codebase, so implemented fresh here): a mentor never sees an
   * undisclosed company name any earlier than the student themselves would.
   */
  async getMenteePlacements(studentId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { class_id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const mentorMapping =
      student.class_id !== null
        ? await this.prisma.class_mentors.findFirst({
            where: { class_id: student.class_id, faculty_id: faculty.id },
          })
        : null;
    if (!mentorMapping) {
      throw new ForbiddenException({
        message: 'You are not the mentor for this student',
        errorCode: 'NOT_THE_MENTOR',
      });
    }

    const applications = await this.prisma.student_drive_applications.findMany({
      where: { student_id: studentId },
      orderBy: { updated_at: 'desc' },
      select: MENTEE_PLACEMENT_SELECT,
    });

    return applications.map(toPlacementResponse);
  }

  /**
   * GET /me/mentees/:student_id/documents (Faculty — the mentee's class
   * mentor only, same auth gate as getMenteeProfile/getMenteeReport).
   *
   * student_certificates is a real table (one row per certificate_types
   * entry, is_available/file_url/verified_at set by admin) that had zero
   * endpoints anywhere reading it before this — added rather than left
   * unused, since "which documents has admin marked received/verified for
   * this mentee" is real, already-modeled data.
   */
  async getMenteeDocuments(studentId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { class_id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const mentorMapping =
      student.class_id !== null
        ? await this.prisma.class_mentors.findFirst({
            where: { class_id: student.class_id, faculty_id: faculty.id },
          })
        : null;
    if (!mentorMapping) {
      throw new ForbiddenException({
        message: 'You are not the mentor for this student',
        errorCode: 'NOT_THE_MENTOR',
      });
    }

    // Every certificate_types row is listed even when the student has no
    // student_certificates row yet, so "not yet received" is distinguishable
    // from "received but not verified" — a missing row and an
    // is_available=false row both mean "not on file" to the caller.
    const [certificateTypes, records] = await Promise.all([
      this.prisma.certificate_types.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.student_certificates.findMany({ where: { student_id: studentId } }),
    ]);
    const byTypeId = new Map(records.map((r) => [r.certificate_type_id, r]));

    return certificateTypes.map((ct) => {
      const record = byTypeId.get(ct.id);
      return {
        certificate_type_id: ct.id,
        name: ct.name,
        is_available: record?.is_available ?? false,
        file_url: record?.file_url ?? null,
        verified_at: record?.verified_at ?? null,
      };
    });
  }

  /**
   * GET /me/children/:student_id/mentor (Parent only).
   *
   * workflow.md (Parent role): "view faculty mentor details of thier
   * son/daughter." Gated by parent_student_mapping — the parent must
   * actually be linked to this student. class_mentors has no "current
   * academic year" flag anywhere in the schema (same gap as the HoD-facing
   * GET /classes/:id/mentor), so the most recently assigned row (highest id)
   * is returned as "the" mentor rather than a full history, matching this
   * endpoint's singular framing in workflow.md.
   */
  async getChildMentor(studentId: number, parentUserId: number) {
    const mapping = await this.prisma.parent_student_mapping.findFirst({
      where: { parent_user_id: parentUserId, student_id: studentId },
    });
    if (!mapping) {
      throw new ForbiddenException({
        message: 'You are not linked to this student',
        errorCode: 'NOT_THIS_PARENT',
      });
    }

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { class_id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    if (student.class_id === null) {
      return { mentor: null };
    }

    const mentorRow = await this.prisma.class_mentors.findFirst({
      where: { class_id: student.class_id },
      orderBy: { id: 'desc' },
      select: {
        academic_year: true,
        faculty: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            designation: true,
            users: { select: { email: true, phone: true } },
          },
        },
      },
    });

    if (!mentorRow) {
      return { mentor: null };
    }

    return {
      mentor: {
        id: mentorRow.faculty.id,
        first_name: mentorRow.faculty.first_name,
        last_name: mentorRow.faculty.last_name,
        designation: mentorRow.faculty.designation,
        email: mentorRow.faculty.users.email,
        phone: mentorRow.faculty.users.phone,
        academic_year: mentorRow.academic_year,
      },
    };
  }

  private async resolveFacultyByUserId(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }
}
