import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

interface StudentSummarySource {
  id: number;
  student_id_no: string;
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
  classes: { section: string } | null;
}

function resolveStudentDisplayName(student: StudentSummarySource): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

function toStudentSummary(student: StudentSummarySource) {
  return {
    id: student.id,
    student_id_no: student.student_id_no,
    name: resolveStudentDisplayName(student),
    section: student.classes?.section ?? null,
  };
}

interface StudentSummaryWithDeptSource extends StudentSummarySource {
  classes: { section: string; departments: { code: string; name: string } } | null;
}

function toStudentSummaryWithDepartment(student: StudentSummaryWithDeptSource) {
  return {
    ...toStudentSummary(student),
    department: student.classes?.departments ?? null,
  };
}

/**
 * Principal-facing registry of students who've registered a startup/
 * business idea (student_entrepreneurship) - read-only, department-scoped
 * via a caller-chosen department. At most one row per student (student_id
 * is unique).
 */
@Injectable()
export class StudentEntrepreneurshipService {
  private readonly logger = new Logger(StudentEntrepreneurshipService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /student-entrepreneurship — every department at once, no picker. */
  async findAll() {
    try {
      const rows = await this.prisma.student_entrepreneurship.findMany({
        include: {
          students: {
            select: {
              id: true,
              student_id_no: true,
              soa_applications: { select: { first_name: true, last_name: true } },
              users: { select: { email: true } },
              classes: { select: { section: true, departments: { select: { code: true, name: true } } } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
      });

      return rows.map((row) => ({
        id: row.id,
        business_name: row.business_name,
        business_description: row.business_description,
        sector: row.sector,
        stage: row.stage,
        funding_required: row.funding_required,
        remarks: row.remarks,
        created_at: row.created_at,
        student: toStudentSummaryWithDepartment(row.students),
      }));
    } catch (err) {
      this.logger.error('DB error listing all student_entrepreneurship', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAllByDepartment(departmentId: number) {
    await this.assertDepartmentExists(departmentId);

    try {
      const rows = await this.prisma.student_entrepreneurship.findMany({
        where: { students: { classes: { department_id: departmentId } } },
        include: {
          students: {
            select: {
              id: true,
              student_id_no: true,
              soa_applications: { select: { first_name: true, last_name: true } },
              users: { select: { email: true } },
              classes: { select: { section: true } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
      });

      return rows.map((row) => ({
        id: row.id,
        business_name: row.business_name,
        business_description: row.business_description,
        sector: row.sector,
        stage: row.stage,
        funding_required: row.funding_required,
        remarks: row.remarks,
        created_at: row.created_at,
        student: toStudentSummary(row.students),
      }));
    } catch (err) {
      this.logger.error(
        `DB error listing student_entrepreneurship for department ${departmentId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertDepartmentExists(departmentId: number) {
    const department = await this.prisma.departments.findUnique({
      where: { id: departmentId },
    });
    if (!department) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }
  }
}
