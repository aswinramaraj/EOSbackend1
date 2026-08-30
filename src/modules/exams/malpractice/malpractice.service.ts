import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { AuditLogService } from 'src/common/audit-log/audit-log.service';
import { CreateMalpracticeDto } from './dto/create-malpractice.dto';
import { UpdateMalpracticeDto } from './dto/update-malpractice.dto';
import { FindMalpracticeQueryDto } from './dto/find-malpractice-query.dto';
import { LookupStudentQueryDto } from './dto/lookup-student-query.dto';

const STUDENT_SELECT = {
  id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
  user_id: true,
  soa_applications: { select: { first_name: true, last_name: true } },
} as const;

const FACULTY_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  designation: true,
} as const;

const VENUE_SELECT = {
  id: true,
  name: true,
  location: true,
} as const;

const EXAM_SUBJECT_MAPPING_SELECT = {
  id: true,
  exam_id: true,
  subject_id: true,
  class_id: true,
  subjects: { select: { id: true, name: true, subject_code: true } },
  classes: {
    select: {
      current_semester: true,
      departments: { select: { id: true, code: true, name: true } },
    },
  },
};

const INCLUDE = {
  students: { select: STUDENT_SELECT },
  faculty: { select: FACULTY_SELECT },
  venues: { select: VENUE_SELECT },
  exam_subject_mapping: { select: EXAM_SUBJECT_MAPPING_SELECT },
  exams: { select: { id: true, academic_year: true, semester: true } },
  users: { select: { id: true, email: true } },
} as const;

@Injectable()
export class MalpracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(dto: CreateMalpracticeDto, recordedByUserId: number) {
    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const exam = await this.prisma.exams.findUnique({
      where: { id: dto.exam_id },
    });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    if (dto.exam_subject_mapping_id !== undefined) {
      const mapping = await this.prisma.exam_subject_mapping.findUnique({
        where: { id: dto.exam_subject_mapping_id },
      });
      if (!mapping) {
        throw new NotFoundException({
          message: 'Exam subject mapping not found',
          errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
        });
      }
    }

    if (dto.venue_id !== undefined) {
      const venue = await this.prisma.venues.findUnique({
        where: { id: dto.venue_id },
      });
      if (!venue) {
        throw new NotFoundException({
          message: 'Venue not found',
          errorCode: 'VENUE_NOT_FOUND',
        });
      }
    }

    if (dto.reported_by_faculty_id !== undefined) {
      const faculty = await this.prisma.faculty.findUnique({
        where: { id: dto.reported_by_faculty_id },
      });
      if (!faculty) {
        throw new NotFoundException({
          message: 'Faculty not found',
          errorCode: 'FACULTY_NOT_FOUND',
        });
      }
    }

    return this.prisma.malpractice_incidents.create({
      data: {
        student_id: dto.student_id,
        exam_id: dto.exam_id,
        exam_subject_mapping_id: dto.exam_subject_mapping_id,
        venue_id: dto.venue_id,
        incident_date: new Date(dto.incident_date),
        session: dto.session,
        seat_number: dto.seat_number,
        nature: dto.nature,
        action_taken: dto.action_taken,
        invigilator_remarks: dto.invigilator_remarks,
        reported_by_faculty_id: dto.reported_by_faculty_id,
        recorded_by_user_id: recordedByUserId,
      },
      include: INCLUDE,
    });
  }

  /** Best-effort real name for whoever recorded the case, when no faculty reporter is on file — same real-name-or-email fallback as confidential-access-log's actor resolution (this system has no display name for a bare `users` row). */
  private async attachRecordedBy<
    T extends {
      recorded_by_user_id: number | null;
      users: { id: number; email: string } | null;
    },
  >(rows: T[]) {
    const userIds = [
      ...new Set(
        rows
          .map((r) => r.recorded_by_user_id)
          .filter((id): id is number => id != null),
      ),
    ];
    const faculty = userIds.length
      ? await this.prisma.faculty.findMany({
          where: { user_id: { in: userIds } },
          select: {
            user_id: true,
            prefix: true,
            first_name: true,
            last_name: true,
            designation: true,
          },
        })
      : [];
    const byUserId = new Map(
      faculty.map((f) => [
        f.user_id,
        {
          name: [f.prefix, f.first_name, f.last_name].filter(Boolean).join(' '),
          role: f.designation,
        },
      ]),
    );

    return rows.map((r) => ({
      ...r,
      recorded_by: r.users
        ? (byUserId.get(r.users.id) ?? { name: r.users.email, role: null })
        : null,
    }));
  }

  async findAll(query: FindMalpracticeQueryDto) {
    const where: Prisma.malpractice_incidentsWhereInput = {};
    if (query.exam_id !== undefined) where.exam_id = query.exam_id;
    if (query.student_id !== undefined) where.student_id = query.student_id;
    if (query.venue_id !== undefined) where.venue_id = query.venue_id;
    if (query.incident_date !== undefined)
      where.incident_date = new Date(query.incident_date);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.malpractice_incidents.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: [{ incident_date: 'desc' }, { id: 'desc' }],
        include: INCLUDE,
      }),
      this.prisma.malpractice_incidents.count({ where }),
    ]);

    return paginate(await this.attachRecordedBy(data), total, query);
  }

  async findOne(id: number) {
    const incident = await this.prisma.malpractice_incidents.findUnique({
      where: { id },
      include: INCLUDE,
    });

    if (!incident) {
      throw new NotFoundException({
        message: 'Malpractice incident not found',
        errorCode: 'MALPRACTICE_INCIDENT_NOT_FOUND',
      });
    }

    return (await this.attachRecordedBy([incident]))[0];
  }

  async update(id: number, dto: UpdateMalpracticeDto) {
    const existing = await this.prisma.malpractice_incidents.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Malpractice incident not found',
        errorCode: 'MALPRACTICE_INCIDENT_NOT_FOUND',
      });
    }

    const data: Prisma.malpractice_incidentsUpdateInput = {};
    if (dto.student_id !== undefined)
      data.students = { connect: { id: dto.student_id } };
    if (dto.exam_id !== undefined)
      data.exams = { connect: { id: dto.exam_id } };
    if (dto.exam_subject_mapping_id !== undefined)
      data.exam_subject_mapping = {
        connect: { id: dto.exam_subject_mapping_id },
      };
    if (dto.venue_id !== undefined)
      data.venues = { connect: { id: dto.venue_id } };
    if (dto.incident_date !== undefined)
      data.incident_date = new Date(dto.incident_date);
    if (dto.session !== undefined) data.session = dto.session;
    if (dto.seat_number !== undefined) data.seat_number = dto.seat_number;
    if (dto.nature !== undefined) data.nature = dto.nature;
    if (dto.action_taken !== undefined) data.action_taken = dto.action_taken;
    if (dto.invigilator_remarks !== undefined)
      data.invigilator_remarks = dto.invigilator_remarks;
    if (dto.reported_by_faculty_id !== undefined)
      data.faculty = { connect: { id: dto.reported_by_faculty_id } };
    if (dto.enquiry_stage !== undefined) data.enquiry_stage = dto.enquiry_stage;
    if (dto.committee_sitting_at !== undefined)
      data.committee_sitting_at = new Date(dto.committee_sitting_at);
    if (dto.appeal_status !== undefined) data.appeal_status = dto.appeal_status;

    return this.prisma.malpractice_incidents.update({
      where: { id },
      data,
      include: INCLUDE,
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.malpractice_incidents.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Malpractice incident not found',
        errorCode: 'MALPRACTICE_INCIDENT_NOT_FOUND',
      });
    }

    await this.prisma.malpractice_incidents.delete({ where: { id } });

    return { id };
  }

  /** POST /malpractice-incidents/:id/notice — a real in-app notification to the candidate's own user account (students.user_id is required, never null). */
  async sendNotice(id: number) {
    const incident = await this.prisma.malpractice_incidents.findUnique({
      where: { id },
      include: {
        students: {
          select: { user_id: true, register_no: true, student_id_no: true },
        },
      },
    });
    if (!incident) {
      throw new NotFoundException({
        message: 'Malpractice incident not found',
        errorCode: 'MALPRACTICE_INCIDENT_NOT_FOUND',
      });
    }
    if (incident.enquiry_stage !== 'under_enquiry') {
      throw new UnprocessableEntityException({
        message: 'A notice can only be sent while the case is under enquiry.',
        errorCode: 'NOT_UNDER_ENQUIRY',
      });
    }

    return this.prisma.notifications.create({
      data: {
        user_id: incident.students.user_id,
        title: 'Malpractice enquiry notice',
        message: `You are required to appear before the enquiry committee regarding case UFM-${incident.incident_date.getUTCFullYear()}-${String(incident.id).padStart(3, '0')}${incident.committee_sitting_at ? ` on ${incident.committee_sitting_at.toISOString().slice(0, 10)}` : ''}.`,
        related_entity_type: 'malpractice_incidents',
        related_entity_id: incident.id,
      },
    });
  }

  /**
   * GET /malpractice-incidents/lookup-student?register_no= — there is no
   * student picker reachable by `coe` anywhere in the backend, so the
   * design's "Register number" field resolves against real students here
   * instead of a raw numeric id. Read-only, doesn't touch the ADMIN-only
   * /students controller.
   */
  async lookupStudent(query: LookupStudentQueryDto) {
    const student = await this.prisma.students.findFirst({
      where: {
        OR: [
          { register_no: query.register_no },
          { student_id_no: query.register_no },
        ],
      },
      select: {
        id: true,
        register_no: true,
        student_id_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        classes: {
          select: {
            current_semester: true,
            departments: { select: { code: true, name: true } },
            batches: { select: { start_year: true } },
          },
        },
      },
    });

    if (!student) {
      throw new NotFoundException({
        message: 'No student found with this register number.',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    // Real regulation resolution — same intake-year match used by
    // student-exam-record.service.ts — shared here so every caller of this
    // lookup (malpractice, convocation, etc.) gets it for free.
    const regulation = student.classes?.batches?.start_year
      ? await this.prisma.regulations.findFirst({
          where: { intake_start_year: student.classes.batches.start_year },
        })
      : null;

    return {
      id: student.id,
      register_no: student.register_no ?? student.student_id_no,
      name: student.soa_applications
        ? [
            student.soa_applications.first_name,
            student.soa_applications.last_name,
          ]
            .filter(Boolean)
            .join(' ')
        : null,
      department_code: student.classes?.departments.code ?? null,
      semester: student.classes?.current_semester ?? null,
      regulation_code: regulation?.code ?? null,
    };
  }
}
