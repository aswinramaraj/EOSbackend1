import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { FacultyOdRequestsService } from 'src/modules/faculty/faculty-od-requests/faculty-od-requests.service';
import { CreateFacultyOdRequestDto } from 'src/modules/faculty/faculty-od-requests/dto/create-faculty-od-request.dto';

const FETCH_LIMIT = 100;

@Injectable()
export class HodEmployeeOdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facultyOdRequestsService: FacultyOdRequestsService,
  ) {}

  private async resolveFaculty(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  /** POST /hod/employee/od — self-service, same create path any faculty (HOD included) already uses. */
  async apply(userId: number, dto: CreateFacultyOdRequestDto) {
    return this.facultyOdRequestsService.create(dto, userId);
  }

  /** GET /hod/employee/od/history?status= — the HOD's own submitted requests only. */
  async getHistory(
    userId: number,
    status?: 'pending' | 'approved' | 'rejected',
  ) {
    const faculty = await this.resolveFaculty(userId);
    const currentUser: JwtPayload = {
      sub: userId,
      role: ROLES.HOD,
      email: '',
      roleId: 0,
    };
    const result = await this.facultyOdRequestsService.findAll(
      {
        page: 1,
        limit: FETCH_LIMIT,
        skip: 0,
        faculty_id: faculty.id,
        hod_approval_status: status,
      },
      currentUser,
    );
    return result.data;
  }
}
