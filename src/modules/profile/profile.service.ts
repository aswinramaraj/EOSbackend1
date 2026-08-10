import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateSocialLinkDto } from './dto/create-social-link.dto';

function toDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function fullName(first: string, last: string | null): string {
  return last ? `${first} ${last}` : first;
}

// Pulls the leading degree abbreviation off a real courses.name value (e.g.
// "B.E." out of "B.E. Electrical and Electronics Engineering", or "B.Tech"
// out of "B.Tech Computer Science and Engineering") - never a fabricated
// or hand-maintained abbreviation, just the natural first token.
function degreeAbbreviation(courseName: string): string {
  const match = courseName.match(/^[A-Za-z.]+/);
  return match ? match[0] : courseName;
}

function formatAddress(
  address:
    | {
        address_line: string | null;
        city: string | null;
        state: string | null;
        pincode: string | null;
      }
    | undefined,
): string | null {
  if (!address) return null;
  const parts = [
    address.address_line,
    address.city,
    address.state,
    address.pincode,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length > 0 ? parts.join(', ') : null;
}

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * GET /me/profile — role-branched summary for the Profile & Resume screen.
   * Every value is read straight off real tables; nothing here is derived
   * from a fixed/hardcoded catalogue. social_links is the free-form,
   * user-authored list (see user_social_links) shared by every role below.
   */
  async getMyProfile(user: JwtPayload) {
    const socialLinks = await this.prisma.user_social_links.findMany({
      where: { user_id: user.sub },
      orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
      select: { id: true, title: true, url: true },
    });

    if (user.role === ROLES.STUDENT) {
      return this.getStudentProfile(user.sub, socialLinks);
    }
    if (user.role === ROLES.PARENT) {
      return this.getParentProfile(user.sub, socialLinks);
    }
    return this.getFacultyProfile(user.sub, socialLinks);
  }

  /**
   * A parent has no personal profile fields of their own anywhere in the
   * schema (no name/photo/designation) - only an email and a
   * parent_student_mapping row per linked child. children reuses the same
   * name-resolution and shape as ParentsService.listChildren, so this and
   * the existing "My Children" list never disagree with each other.
   */
  private async getParentProfile(
    userId: number,
    socialLinks: { id: number; title: string; url: string }[],
  ) {
    const parentUser = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!parentUser) {
      throw new NotFoundException({
        message: 'Account not found',
        errorCode: 'USER_NOT_FOUND',
      });
    }

    const mappings = await this.prisma.parent_student_mapping.findMany({
      where: { parent_user_id: userId },
      select: {
        relationship: true,
        students: {
          select: {
            id: true,
            student_id_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
            classes: {
              select: {
                section: true,
                departments: { select: { name: true, code: true } },
              },
            },
            courses: { select: { name: true } },
          },
        },
      },
    });

    const children = mappings.map((mapping) => ({
      id: mapping.students.id,
      name: mapping.students.soa_applications
        ? fullName(
            mapping.students.soa_applications.first_name,
            mapping.students.soa_applications.last_name,
          )
        : mapping.students.users.email,
      student_id_no: mapping.students.student_id_no,
      relationship: mapping.relationship,
      course: mapping.students.courses.name,
      section: mapping.students.classes?.section ?? null,
      department: mapping.students.classes?.departments?.name ?? null,
    }));

    return {
      role: 'parent' as const,
      name: parentUser.email,
      id_no: `PARENT-${userId}`,
      designation: 'Parent / Guardian',
      department: null,
      photo_url: null,
      resume_url: null,
      work_email: parentUser.email,
      date_of_joining: null,
      reporting_to: null,
      social_links: socialLinks,
      children,
    };
  }

  private async getStudentProfile(
    userId: number,
    socialLinks: { id: number; title: string; url: string }[],
  ) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: {
        student_id_no: true,
        photo_url: true,
        admission_date: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
        courses: { select: { name: true } },
        classes: { select: { id: true, section: true } },
        batches: { select: { name: true, start_year: true, end_year: true } },
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
      },
    });

    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    let reportingTo: string | null = null;
    if (student.classes) {
      const mentor = await this.prisma.class_mentors.findFirst({
        where: { class_id: student.classes.id },
        orderBy: { id: 'desc' },
        select: {
          faculty: { select: { first_name: true, last_name: true } },
        },
      });
      reportingTo = mentor
        ? `${fullName(mentor.faculty.first_name, mentor.faculty.last_name)} (Mentor)`
        : null;
    }

    return {
      role: 'student' as const,
      name: student.soa_applications
        ? fullName(
            student.soa_applications.first_name,
            student.soa_applications.last_name,
          )
        : student.users.email,
      id_no: student.student_id_no,
      designation: student.courses.name,
      department: student.batches
        ? `${student.batches.name} · Section ${student.classes?.section ?? '-'}`
        : null,
      photo_url: student.photo_url,
      resume_url: student.student_profiles?.resume_url ?? null,
      work_email: student.users.email,
      date_of_joining: toDateOnly(student.admission_date),
      reporting_to: reportingTo,
      social_links: socialLinks,
    };
  }

  private async getFacultyProfile(
    userId: number,
    socialLinks: { id: number; title: string; url: string }[],
  ) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        designation: true,
        date_of_joining: true,
        profile_url: true,
        resume_url: true,
        users: { select: { email: true } },
        departments_faculty_department_idTodepartments: {
          select: { name: true, code: true },
        },
        faculty: { select: { first_name: true, last_name: true } },
      },
    });

    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty profile not found for this account',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }

    return {
      role: 'faculty' as const,
      name: fullName(faculty.first_name, faculty.last_name),
      id_no: `EMP-${faculty.departments_faculty_department_idTodepartments.code}-${faculty.id}`,
      designation: faculty.designation,
      department: faculty.departments_faculty_department_idTodepartments.name,
      photo_url: faculty.profile_url,
      resume_url: faculty.resume_url,
      work_email: faculty.users.email,
      date_of_joining: toDateOnly(faculty.date_of_joining),
      reporting_to: faculty.faculty
        ? fullName(faculty.faculty.first_name, faculty.faculty.last_name)
        : null,
      social_links: socialLinks,
    };
  }

  /**
   * POST /me/profile/resume — uploads to the public Supabase bucket and
   * writes to student_profiles.resume_url (upserted - a student may not
   * have a student_profiles row yet) or faculty.resume_url. Never accepts
   * a URL from the client - always derives it from the freshly-uploaded
   * object. (Profile photos have no equivalent upload endpoint - they are
   * admin-managed directly in the DB, see ProfileController.)
   */
  async uploadResume(user: JwtPayload, file: Express.Multer.File) {
    const { key } = await this.storage.upload(
      'resumes',
      file.originalname,
      file.buffer,
      file.mimetype,
    );
    const resumeUrl = this.storage.getPublicUrl(key);

    if (user.role === ROLES.STUDENT) {
      const student = await this.prisma.students.findUnique({
        where: { user_id: user.sub },
        select: { id: true },
      });
      if (!student) {
        throw new NotFoundException({
          message: 'Student profile not found for this account',
          errorCode: 'STUDENT_NOT_FOUND',
        });
      }
      await this.prisma.student_profiles.upsert({
        where: { student_id: student.id },
        create: { student_id: student.id, resume_url: resumeUrl },
        update: { resume_url: resumeUrl },
      });
    } else {
      const faculty = await this.prisma.faculty.findUnique({
        where: { user_id: user.sub },
        select: { id: true },
      });
      if (!faculty) {
        throw new NotFoundException({
          message: 'Faculty profile not found for this account',
          errorCode: 'FACULTY_NOT_FOUND',
        });
      }
      await this.prisma.faculty.update({
        where: { id: faculty.id },
        data: { resume_url: resumeUrl },
      });
    }

    return { resume_url: resumeUrl };
  }

  /** POST /me/profile/social-links — appended to the end of the caller's own list. */
  async addSocialLink(user: JwtPayload, dto: CreateSocialLinkDto) {
    const last = await this.prisma.user_social_links.findFirst({
      where: { user_id: user.sub },
      orderBy: { display_order: 'desc' },
      select: { display_order: true },
    });

    const link = await this.prisma.user_social_links.create({
      data: {
        user_id: user.sub,
        title: dto.title,
        url: dto.url,
        display_order: (last?.display_order ?? -1) + 1,
      },
      select: { id: true, title: true, url: true },
    });

    return link;
  }

  /** DELETE /me/profile/social-links/:id — only the caller's own link. */
  async removeSocialLink(user: JwtPayload, id: number) {
    const existing = await this.prisma.user_social_links.findUnique({
      where: { id },
    });
    if (!existing || existing.user_id !== user.sub) {
      throw new NotFoundException({
        message: 'Social link not found',
        errorCode: 'SOCIAL_LINK_NOT_FOUND',
      });
    }
    await this.prisma.user_social_links.delete({ where: { id } });
    return { id, deleted: true };
  }

  /**
   * GET /me/profile/id-card — front + back data for the Digital ID Card,
   * role-branched. Purely a read; no issuance side effect (see issueIdCard).
   *
   * degree_dept_label is built from real substrings only: the leading
   * degree abbreviation already present at the start of courses.name
   * (e.g. "B.E." out of "B.E. Electrical and Electronics Engineering")
   * plus departments.code (the DB's own short-form column, e.g. "EEE") -
   * never a hand-maintained lookup table, so it can never drift from
   * whatever department codes actually exist.
   */
  async getIdCard(user: JwtPayload) {
    if (user.role === ROLES.STUDENT) {
      const student = await this.prisma.students.findUnique({
        where: { user_id: user.sub },
        select: {
          student_id_no: true,
          roll_no: true,
          photo_url: true,
          blood_group: true,
          date_of_birth: true,
          soa_applications: { select: { first_name: true, last_name: true } },
          users: { select: { email: true } },
          courses: { select: { name: true } },
          classes: {
            select: {
              section: true,
              departments: { select: { code: true } },
            },
          },
          batches: { select: { start_year: true, end_year: true } },
          student_family_details: {
            select: {
              father_name: true,
              father_mobile: true,
              mother_name: true,
              mother_mobile: true,
            },
          },
          student_addresses: {
            where: { address_type: 'permanent' },
            select: {
              address_line: true,
              city: true,
              state: true,
              pincode: true,
            },
          },
        },
      });

      if (!student) {
        throw new NotFoundException({
          message: 'Student profile not found for this account',
          errorCode: 'STUDENT_NOT_FOUND',
        });
      }

      const family = student.student_family_details;
      const address = student.student_addresses[0];

      return {
        role: 'student' as const,
        name: student.soa_applications
          ? fullName(
              student.soa_applications.first_name,
              student.soa_applications.last_name,
            )
          : student.users.email,
        photo_url: student.photo_url,
        secondary_id_label: 'Roll No',
        secondary_id: student.roll_no ?? student.student_id_no,
        degree_dept_label: student.classes?.departments
          ? `${degreeAbbreviation(student.courses.name)} ${student.classes.departments.code}`
          : student.courses.name,
        batch_label: student.batches
          ? `${student.batches.start_year} - ${student.batches.end_year}`
          : null,
        issued_at: null,
        blood_group: student.blood_group,
        date_of_birth: toDateOnly(student.date_of_birth),
        parent_name: family?.father_name ?? family?.mother_name ?? null,
        resi_tel_no: family?.father_mobile ?? family?.mother_mobile ?? null,
        address: formatAddress(address),
      };
    }

    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        designation: true,
        profile_url: true,
        date_of_birth: true,
        personal_email: true,
        whatsapp_number: true,
        alternate_phone: true,
        address_line: true,
        city: true,
        state: true,
        postal_code: true,
        departments_faculty_department_idTodepartments: {
          select: { name: true, code: true },
        },
        faculty_id_card_issuances: {
          orderBy: { issued_at: 'desc' },
          take: 1,
          select: { issued_at: true },
        },
      },
    });

    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty profile not found for this account',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }

    return {
      role: 'faculty' as const,
      name: fullName(faculty.first_name, faculty.last_name),
      photo_url: faculty.profile_url,
      secondary_id_label: 'Employee ID',
      secondary_id: `EMP-${faculty.departments_faculty_department_idTodepartments.code}-${faculty.id}`,
      degree_dept_label: faculty.designation,
      batch_label: faculty.departments_faculty_department_idTodepartments.name,
      issued_at: faculty.faculty_id_card_issuances[0]?.issued_at ?? null,
      // Faculty has no blood_group column anywhere in the schema (only
      // students do) - left null rather than fabricated; see conversation
      // with the user about whether to add one via manual SQL.
      blood_group: null,
      date_of_birth: toDateOnly(faculty.date_of_birth),
      // "Parent Name" has no meaning for a faculty member - personal_email
      // is the nearest real, always-present-in-schema equivalent contact
      // field, shown under the same row (see IdCardBack's "Contact" label).
      parent_name: faculty.personal_email,
      resi_tel_no: faculty.whatsapp_number ?? faculty.alternate_phone ?? null,
      address: formatAddress({
        address_line: faculty.address_line,
        city: faculty.city,
        state: faculty.state,
        pincode: faculty.postal_code,
      }),
    };
  }

  /**
   * POST /me/profile/id-card/issue — call once when the user taps "Generate
   * ID Card" (not on every preview render). Only faculty/HoD/HR Payroll rows
   * have an issuance audit table (faculty_id_card_issuances) - students have
   * no equivalent table in the schema, so this is a no-op for them and the
   * preview simply reflects live data instead.
   */
  async issueIdCard(user: JwtPayload) {
    if (user.role === ROLES.STUDENT) {
      return { issued_at: new Date().toISOString() };
    }

    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty profile not found for this account',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }

    try {
      const issuance = await this.prisma.faculty_id_card_issuances.create({
        data: { faculty_id: faculty.id, issued_by_user_id: user.sub },
        select: { issued_at: true },
      });
      return { issued_at: issuance.issued_at.toISOString() };
    } catch (err) {
      this.logger.error(
        `Failed to record ID card issuance for faculty ${faculty.id}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
