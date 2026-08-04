import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateAlumniProfileDto } from './dto/update-alumni-profile.dto';

/**
 * `students`/`users` have no generic display-name column — a student's name
 * lives on `soa_applications` (nullable: not every student has a linked
 * admission application). Falls back to `users.email`, matching the same
 * substitution used throughout the codebase wherever a student name is
 * needed without a guaranteed soa_applications link.
 */
function resolveStudentName(student: {
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
}): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

@Injectable()
export class MeAlumniGroupService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /me/alumni/group — the caller's own batch plus the full roster. */
  async getOwnGroup(userId: number) {
    const member = await this.getOwnMemberOrThrow(userId);

    const group = await this.prisma.alumni_batches.findUnique({
      where: { id: member.alumni_batch_id },
      include: {
        batches: { select: { id: true, name: true } },
        alumni_members: {
          include: {
            students: {
              select: {
                id: true,
                student_id_no: true,
                users: { select: { email: true } },
                soa_applications: {
                  select: { first_name: true, last_name: true },
                },
              },
            },
          },
        },
      },
    });
    // member.alumni_batch_id always references a real row (FK), so this can't be null.
    const nonNullGroup = group!;

    return {
      id: nonNullGroup.id,
      batch_id: nonNullGroup.batch_id,
      batch_name: nonNullGroup.batches.name,
      group_name: nonNullGroup.group_name,
      graduated_on: nonNullGroup.graduated_on,
      members: nonNullGroup.alumni_members.map((m) => ({
        id: m.id,
        student_id: m.student_id,
        student_id_no: m.students.student_id_no,
        name: resolveStudentName(m.students),
        personal_email: m.personal_email,
        personal_phone: m.personal_phone,
        current_company: m.current_company,
        designation: m.designation,
        status: m.status,
      })),
    };
  }

  /** PUT /me/alumni/profile — updates only the caller's own alumni_members row. */
  async updateOwnProfile(userId: number, dto: UpdateAlumniProfileDto) {
    const member = await this.getOwnMemberOrThrow(userId);

    return this.prisma.alumni_members.update({
      where: { id: member.id },
      data: {
        personal_email: dto.personal_email,
        personal_phone: dto.personal_phone,
        current_company: dto.current_company,
        designation: dto.designation,
      },
    });
  }

  /**
   * Resolves the caller's own alumni_members row via
   * users -> students -> alumni_members. 403 (not 404) when missing — the
   * caller is a valid authenticated user, just not an alumnus.
   */
  private async getOwnMemberOrThrow(userId: number) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for the current user',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const member = await this.prisma.alumni_members.findUnique({
      where: { student_id: student.id },
    });
    if (!member) {
      throw new ForbiddenException({
        message: 'You are not registered as an alumnus',
        errorCode: 'NOT_AN_ALUMNUS',
      });
    }

    return member;
  }
}
