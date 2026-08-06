import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class MeHostelRoomService {
  private readonly logger = new Logger(MeHostelRoomService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/hostel-room
   *
   * Self-scoped: student_id resolved from the JWT. `student_name` is
   * resolved the same way ComplaintsService does for the warden console
   * (`soa_applications.first_name/last_name`, falling back to
   * "Student <student_id_no>") - `students`/`users` themselves have no name
   * column. `is_hostel_resident: false` (with every room field null) is a
   * normal response, not an error - a day scholar has no
   * student_hostel_mapping row.
   *
   * There is no warden display name anywhere in the schema
   * (`hostels.warden_user_id` only resolves to `users.email`), so it's
   * deliberately left out of this response rather than surfaced as a raw
   * email standing in for a name.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  500 INTERNAL_ERROR    – unexpected DB failure
   */
  async getMyHostelRoom(userId: number) {
    const student = await this.fetchStudent(userId);

    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const studentName = student.soa_applications
      ? `${student.soa_applications.first_name} ${student.soa_applications.last_name ?? ''}`.trim()
      : `Student ${student.student_id_no}`;

    const mapping = await this.fetchMapping(userId, student.id);

    if (!mapping) {
      return {
        is_hostel_resident: false,
        student_name: studentName,
        register_no: student.register_no,
        hostel_name: null,
        room_number: null,
        room_type_name: null,
        mess_type: null,
      };
    }

    return {
      is_hostel_resident: true,
      student_name: studentName,
      register_no: student.register_no,
      hostel_name: mapping.hostel_rooms.hostels.name,
      room_number: mapping.hostel_rooms.room_number,
      room_type_name: mapping.hostel_rooms.hostel_room_types.name,
      mess_type: mapping.hostel_rooms.hostels.mess_type,
    };
  }

  private async fetchStudent(userId: number) {
    try {
      return await this.prisma.students.findUnique({
        where: { user_id: userId },
        select: {
          id: true,
          student_id_no: true,
          register_no: true,
          soa_applications: { select: { first_name: true, last_name: true } },
        },
      });
    } catch (err) {
      this.logger.error(`Failed to fetch student for user ${userId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async fetchMapping(userId: number, studentId: number) {
    try {
      return await this.prisma.student_hostel_mapping.findUnique({
        where: { student_id: studentId },
        select: {
          hostel_rooms: {
            select: {
              room_number: true,
              hostels: { select: { name: true, mess_type: true } },
              hostel_room_types: { select: { name: true } },
            },
          },
        },
      });
    } catch (err) {
      this.logger.error(`Failed to fetch hostel mapping for user ${userId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
