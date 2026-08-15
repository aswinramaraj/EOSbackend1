import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateMyHostelComplaintDto } from './dto/create-my-hostel-complaint.dto';

@Injectable()
export class MeHostelComplaintsService {
  private readonly logger = new Logger(MeHostelComplaintsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /me/hostel-complaints
   *
   * Self-scoped: student_id resolved from the JWT, never accepted from the
   * request. `hostel_id` is resolved server-side from the caller's own
   * student_hostel_mapping - same hosteller gate as
   * MeHostelOutingsService.createHostelOuting (a day scholar has nothing to
   * raise a hostel complaint against).
   *
   * hostel_complaints itself is otherwise staff-authored
   * (ROLES.ADMIN/WARDEN via /hostel/complaints) - this is the
   * self-service counterpart the module's own DTO comment flagged as a
   * reasonable future addition.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  422 NOT_A_HOSTELLER   – caller has no student_hostel_mapping row
   *  500 INTERNAL_ERROR    – unexpected DB failure
   */
  async createComplaint(userId: number, dto: CreateMyHostelComplaintDto) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const mapping = await this.prisma.student_hostel_mapping.findUnique({
      where: { student_id: student.id },
      select: { hostel_rooms: { select: { hostel_id: true } } },
    });
    if (!mapping) {
      throw new UnprocessableEntityException({
        message: 'Only hostellers can raise a hostel complaint',
        errorCode: 'NOT_A_HOSTELLER',
      });
    }

    try {
      const complaint = await this.prisma.hostel_complaints.create({
        data: {
          student_id: student.id,
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
      this.logger.error(
        `Failed to create hostel complaint for user ${userId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
