import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { paginate } from 'src/common/dto/pagination.dto';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateFacultyOdDto } from './dto/create-faculty-od.dto';
import { ListFacultyOdQueryDto } from './dto/list-faculty-od-query.dto';

const FACULTY_OD_SELECT = {
  id: true,
  from_date: true,
  to_date: true,
  place: true,
  purpose: true,
  hod_approval_status: true,
  hr_approval_status: true,
  created_at: true,
  faculty: {
    select: { id: true, first_name: true, last_name: true, designation: true },
  },
} as const;

interface FacultyOdRow {
  id: number;
  from_date: Date;
  to_date: Date;
  place: string | null;
  purpose: string | null;
  hod_approval_status: string;
  hr_approval_status: string;
  created_at: Date;
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
  };
}

function computeOverallStatus(
  hod: string,
  hr: string,
): 'pending' | 'approved' | 'rejected' {
  if (hod === 'rejected' || hr === 'rejected') {
    return 'rejected';
  }
  if (hod === 'approved' && hr === 'approved') {
    return 'approved';
  }
  return 'pending';
}

function toResponse(od: FacultyOdRow) {
  return {
    id: od.id,
    from_date: od.from_date,
    to_date: od.to_date,
    place: od.place,
    purpose: od.purpose,
    hod_approval_status: od.hod_approval_status,
    hr_approval_status: od.hr_approval_status,
    overall_status: computeOverallStatus(
      od.hod_approval_status,
      od.hr_approval_status,
    ),
    created_at: od.created_at,
    faculty: od.faculty,
  };
}

@Injectable()
export class FacultyOdService {
  private readonly logger = new Logger(FacultyOdService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** POST /me/create-od (Faculty only — always for the caller's own faculty record). */
  async create(dto: CreateFacultyOdDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const fromDate = new Date(dto.from_date);
    const toDate = new Date(dto.to_date);
    const today = new Date(new Date().toISOString().slice(0, 10));

    if (fromDate < today) {
      throw new BadRequestException(
        "from_date must not be before today's date",
      );
    }

    if (fromDate > toDate) {
      throw new BadRequestException('from_date must be on or before to_date');
    }

    const od = await this.prisma.faculty_od_requests.create({
      data: {
        faculty_id: faculty.id,
        from_date: fromDate,
        to_date: toDate,
        place: dto.place,
        purpose: dto.purpose,
      },
      select: FACULTY_OD_SELECT,
    });

    this.logger.log(`Faculty OD request created: id=${od.id}`);
    return toResponse(od);
  }

  /** GET /me/faculty-od (Faculty/HoD/HR Payroll). Faculty is always scoped to their own records. */
  async findAll(query: ListFacultyOdQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {
      faculty_id: query.faculty_id,
      hod_approval_status: query.hod_approval_status,
      hr_approval_status: query.hr_approval_status,
    };

    if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      where.faculty_id = faculty.id;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.faculty_od_requests.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: FACULTY_OD_SELECT,
      }),
      this.prisma.faculty_od_requests.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  private async resolveFacultyByUserId(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }
}
