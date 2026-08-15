import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { formatStudentName } from '../common/student-name.util';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import {
  UpdateComplaintDto,
  HostelComplaintStatus,
} from './dto/update-complaint.dto';
import { SearchComplaintsDto } from './dto/search-complaints.dto';

const COMPLAINT_INCLUDE = {
  students: {
    select: {
      id: true,
      user_id: true,
      student_id_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      users: { select: { email: true } },
      student_hostel_mapping: {
        select: { hostel_rooms: { select: { room_number: true } } },
      },
    },
  },
  hostels: { select: { id: true, name: true, code: true } },
} satisfies Prisma.hostel_complaintsInclude;

type ComplaintWithRelations = Prisma.hostel_complaintsGetPayload<{
  include: typeof COMPLAINT_INCLUDE;
}>;

function toComplaintResponse(complaint: ComplaintWithRelations) {
  const student = complaint.students;
  const name = formatStudentName(
    student.soa_applications?.first_name,
    student.soa_applications?.last_name,
    student.users.email,
  );

  return {
    id: complaint.id,
    student: { id: student.id, name, student_id_no: student.student_id_no },
    room_number:
      student.student_hostel_mapping?.hostel_rooms.room_number ?? null,
    hostel: complaint.hostels,
    category: complaint.category,
    title: complaint.title,
    description: complaint.description,
    priority: complaint.priority,
    status: complaint.status,
    assigned_to: complaint.assigned_to,
    resolution_note: complaint.resolution_note,
    resolved_at: complaint.resolved_at?.toISOString() ?? null,
    created_at: complaint.created_at.toISOString(),
  };
}

@Injectable()
export class ComplaintsService {
  private readonly logger = new Logger(ComplaintsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * POST /hostel/complaints
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – student_id does not exist
   */
  async create(dto: CreateComplaintDto) {
    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    try {
      const complaint = await this.prisma.hostel_complaints.create({
        data: {
          student_id: dto.student_id,
          hostel_id: dto.hostel_id,
          category: dto.category,
          title: dto.title,
          description: dto.description,
          priority: dto.priority,
        },
        include: COMPLAINT_INCLUDE,
      });
      return toComplaintResponse(complaint);
    } catch (err) {
      this.logger.error('DB error while creating hostel complaint', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /hostel/complaints?status=&category=&hostel_id=&page=&page_size= */
  async findAll(dto: SearchComplaintsDto) {
    const { status, category, hostel_id, page = 1, page_size = 20 } = dto;

    const where: Prisma.hostel_complaintsWhereInput = {};
    if (status) where.status = status;
    if (category) where.category = category;
    if (hostel_id) where.hostel_id = hostel_id;

    try {
      const [complaints, total] = await this.prisma.$transaction([
        this.prisma.hostel_complaints.findMany({
          where,
          include: COMPLAINT_INCLUDE,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * page_size,
          take: page_size,
        }),
        this.prisma.hostel_complaints.count({ where }),
      ]);

      return {
        page,
        page_size,
        total,
        data: complaints.map(toComplaintResponse),
      };
    } catch (err) {
      this.logger.error('DB error while fetching hostel complaints', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /hostel/complaints/:id
   *
   * Error cases:
   *  404 COMPLAINT_NOT_FOUND – no complaint with the given id
   */
  async update(id: number, dto: UpdateComplaintDto) {
    const complaint = await this.prisma.hostel_complaints.findUnique({
      where: { id },
    });
    if (!complaint) {
      throw new NotFoundException({
        message: 'Complaint not found',
        errorCode: 'COMPLAINT_NOT_FOUND',
      });
    }

    try {
      const updated = await this.prisma.hostel_complaints.update({
        where: { id },
        data: {
          status: dto.status,
          priority: dto.priority,
          assigned_to: dto.assigned_to,
          resolution_note: dto.resolution_note,
          resolved_at:
            dto.status === HostelComplaintStatus.resolved
              ? new Date()
              : undefined,
        },
        include: COMPLAINT_INCLUDE,
      });

      if (dto.status !== undefined) {
        try {
          await this.notifications.notify({
            user_id: updated.students.user_id,
            title: 'Hostel complaint status updated',
            message: `Your complaint "${updated.title}" is now: ${updated.status}.`,
            type: 'hostel_complaint_status_updated',
            related_entity_type: 'hostel_complaint',
            related_entity_id: updated.id,
          });
        } catch (notifyErr) {
          this.logger.error(`Failed to notify student of hostel complaint ${id} status update`, notifyErr);
        }
      }

      return toComplaintResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating hostel complaint', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
