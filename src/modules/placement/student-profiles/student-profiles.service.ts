import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { paginate } from '../../../common/dto/pagination.dto';
import { ROLES } from '../../../common/constants/roles.constant';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { CreateStudentProjectDto } from './dto/create-student-project.dto';
import { UpdateStudentProjectDto } from './dto/update-student-project.dto';
import { UpdateStudentProfileDto } from './dto/update-student-profile.dto';
import { ListStudentProfilesQueryDto } from './dto/list-student-profiles-query.dto';

@Injectable()
export class StudentProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────── Student: own profile & projects ─────────────────────────────

  async getOwnProfile(user: JwtPayload) {
    const student = await this.getStudentOrThrow(user.sub);
    return this.getProfileAndProjects(student.id);
  }

  async upsertOwnProfile(user: JwtPayload, dto: UpdateStudentProfileDto) {
    const student = await this.getStudentOrThrow(user.sub);

    return this.prisma.student_profiles.upsert({
      where: { student_id: student.id },
      create: { student_id: student.id, ...dto },
      update: { ...dto },
    });
  }

  async addOwnProject(user: JwtPayload, dto: CreateStudentProjectDto) {
    const student = await this.getStudentOrThrow(user.sub);
    if (dto.mentor_faculty_id) {
      await this.assertFacultyExists(dto.mentor_faculty_id);
    }

    return this.prisma.student_projects.create({
      data: {
        student_id: student.id,
        title: dto.title,
        description: dto.description,
        mentor_faculty_id: dto.mentor_faculty_id,
      },
    });
  }

  async updateOwnProject(
    user: JwtPayload,
    projectId: number,
    dto: UpdateStudentProjectDto,
  ) {
    const student = await this.getStudentOrThrow(user.sub);
    const project = await this.findOwnProjectOrThrow(student.id, projectId);
    if (dto.mentor_faculty_id) {
      await this.assertFacultyExists(dto.mentor_faculty_id);
    }

    return this.prisma.student_projects.update({
      where: { id: project.id },
      data: {
        title: dto.title,
        description: dto.description,
        mentor_faculty_id: dto.mentor_faculty_id,
      },
    });
  }

  async removeOwnProject(user: JwtPayload, projectId: number) {
    const student = await this.getStudentOrThrow(user.sub);
    const project = await this.findOwnProjectOrThrow(student.id, projectId);

    await this.prisma.student_projects.delete({ where: { id: project.id } });
    return { id: project.id };
  }

  // ───────────────────────────── Placement / mentor faculty: viewing ─────────────────────────────

  async listProfiles(dto: ListStudentProfilesQueryDto) {
    const where: Record<string, unknown> = {};
    if (dto.batch_id) where.batch_id = dto.batch_id;
    if (dto.course_id) where.course_id = dto.course_id;
    if (dto.has_resume) {
      where.student_profiles = { resume_url: { not: null } };
    }

    const [data, total] = await Promise.all([
      this.prisma.students.findMany({
        where,
        skip: dto.skip,
        take: dto.limit,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          student_id_no: true,
          roll_no: true,
          batch_id: true,
          course_id: true,
          student_profiles: true,
          classes: {
            select: {
              section: true,
              departments: { select: { name: true, code: true } },
            },
          },
          soa_applications: {
            select: { first_name: true, last_name: true },
          },
          _count: { select: { student_projects: true } },
        },
      }),
      this.prisma.students.count({ where }),
    ]);

    return paginate(data, total, dto);
  }

  async getProfileForViewer(viewer: JwtPayload, studentId: number) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });
    if (!student) throw new NotFoundException(`Student ${studentId} not found`);

    if (viewer.role === ROLES.FACULTY) {
      await this.assertIsMentor(viewer.sub, student.class_id);
    }

    return this.getProfileAndProjects(studentId);
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  private async getProfileAndProjects(studentId: number) {
    const [profile, projects] = await Promise.all([
      this.prisma.student_profiles.findUnique({
        where: { student_id: studentId },
      }),
      this.prisma.student_projects.findMany({
        where: { student_id: studentId },
        include: {
          faculty: { select: { id: true, first_name: true, last_name: true } },
        },
      }),
    ]);

    return { student_id: studentId, profile, projects };
  }

  private async assertIsMentor(facultyUserId: number, classId: number | null) {
    if (!classId) {
      throw new ForbiddenException(
        'This student is not currently assigned to a class',
      );
    }

    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: facultyUserId },
    });
    if (!faculty) {
      throw new ForbiddenException(
        'Faculty profile not found for the current user',
      );
    }

    const mentorship = await this.prisma.class_mentors.findFirst({
      where: { faculty_id: faculty.id, class_id: classId },
    });
    if (!mentorship) {
      throw new ForbiddenException('You are not the mentor for this student');
    }
  }

  private async assertFacultyExists(id: number) {
    const faculty = await this.prisma.faculty.findUnique({ where: { id } });
    if (!faculty) throw new NotFoundException(`Faculty ${id} not found`);
  }

  private async getStudentOrThrow(userId: number) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
    });
    if (!student) {
      throw new NotFoundException(
        'Student profile not found for the current user',
      );
    }
    return student;
  }

  private async findOwnProjectOrThrow(studentId: number, projectId: number) {
    const project = await this.prisma.student_projects.findUnique({
      where: { id: projectId },
    });
    if (!project || project.student_id !== studentId) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    return project;
  }
}
