import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateMyHostelComplaintDto } from 'src/modules/admissions/students/me-profile/dto/create-my-hostel-complaint.dto';

/**
 * Self-service hostel complaints for a hostel-resident FACULTY member -
 * the faculty-side counterpart of MeHostelComplaintsService (student self
 * service). hostel_complaints.faculty_id is a sibling column to student_id
 * (both nullable, exactly one set per row - see the
 * hostel_complaints_faculty_support migration), so this reuses the exact
 * same table/enum/DTO, just keyed by faculty_hostel_mapping instead of
 * student_hostel_mapping.
 */
@Injectable()
export class FacultyHostelComplaintsService {
  private readonly logger = new Logger(FacultyHostelComplaintsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async resolveFacultyId(userId: number): Promise<number> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty profile not found for this account',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty.id;
  }

  async createComplaint(userId: number, dto: CreateMyHostelComplaintDto) {
    const facultyId = await this.resolveFacultyId(userId);

    const mapping = await this.prisma.faculty_hostel_mapping.findUnique({
      where: { faculty_id: facultyId },
      select: { hostel_rooms: { select: { hostel_id: true } } },
    });
    if (!mapping) {
      throw new UnprocessableEntityException({
        message: 'Only hostel-resident faculty can raise a hostel complaint',
        errorCode: 'NOT_A_HOSTELLER',
      });
    }

    try {
      const complaint = await this.prisma.hostel_complaints.create({
        data: {
          faculty_id: facultyId,
          hostel_id: mapping.hostel_rooms.hostel_id,
          category: dto.category,
          title: dto.title,
          description: dto.description,
        },
      });

      return {
        id: complaint.id,
        category: complaint.category,
        title: complaint.title,
        description: complaint.description,
        status: complaint.status,
        created_at: complaint.created_at.toISOString(),
      };
    } catch (err) {
      this.logger.error(`Failed to create hostel complaint for user ${userId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async listMyComplaints(userId: number) {
    const facultyId = await this.resolveFacultyId(userId);

    const rows = await this.prisma.hostel_complaints.findMany({
      where: { faculty_id: facultyId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        category: true,
        title: true,
        description: true,
        priority: true,
        status: true,
        resolution_note: true,
        resolved_at: true,
        created_at: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      description: r.description,
      priority: r.priority,
      status: r.status,
      resolution_note: r.resolution_note,
      resolved_at: r.resolved_at,
      created_at: r.created_at,
    }));
  }
}
