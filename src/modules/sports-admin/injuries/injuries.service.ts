import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import {
  STUDENT_DISPLAY_INCLUDE,
  resolveStudentName,
  INTERNAL_ERROR,
} from 'src/modules/sports-admin/common/sports-common';
import { CreateInjuryDto } from './dto/create-injury.dto';
import { UpdateInjuryDto } from './dto/update-injury.dto';
import { SearchInjuriesDto } from './dto/search-injuries.dto';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const INJURY_INCLUDE = {
  students: { include: STUDENT_DISPLAY_INCLUDE },
  sports_facilities: { select: { id: true, name: true } },
} satisfies Prisma.sports_injuriesInclude;

type InjuryWithRelations = Prisma.sports_injuriesGetPayload<{
  include: typeof INJURY_INCLUDE;
}>;

function toInjuryResponse(injury: InjuryWithRelations) {
  return {
    id: injury.id,
    incident_type: injury.incident_type,
    student: injury.students
      ? { id: injury.students.id, name: resolveStudentName(injury.students) }
      : null,
    facility: injury.sports_facilities
      ? { id: injury.sports_facilities.id, name: injury.sports_facilities.name }
      : null,
    incident: injury.incident,
    incident_date: toDateOnly(injury.incident_date),
    status: injury.status,
    care_notes: injury.care_notes,
    return_to_play_date: injury.return_to_play_date
      ? toDateOnly(injury.return_to_play_date)
      : null,
  };
}

@Injectable()
export class InjuriesService {
  private readonly logger = new Logger(InjuriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /sports-admin/injuries
   *
   * Error cases:
   *  400 INJURY_STUDENT_REQUIRED – incident_type is 'injury' but no student_id
   *  400 INCIDENT_FACILITY_REQUIRED – incident_type is 'facility' but no facility_id
   *  500 INTERNAL_ERROR – unexpected failure (DB, etc.)
   */
  async create(dto: CreateInjuryDto) {
    this.assertSubject(dto.incident_type, dto.student_id, dto.facility_id);

    try {
      const injury = await this.prisma.sports_injuries.create({
        data: {
          incident_type: dto.incident_type,
          student_id: dto.student_id,
          facility_id: dto.facility_id,
          discipline_id: dto.discipline_id,
          incident: dto.incident,
          incident_date: new Date(dto.incident_date),
          care_notes: dto.care_notes,
          status: dto.status,
          return_to_play_date: dto.return_to_play_date
            ? new Date(dto.return_to_play_date)
            : undefined,
          medical_visit_id: dto.medical_visit_id,
        },
        include: INJURY_INCLUDE,
      });
      return toInjuryResponse(injury);
    } catch (err) {
      this.logger.error('DB error while creating injury', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** GET /sports-admin/injuries?status=&incident_type= */
  async findAll(dto: SearchInjuriesDto) {
    const where: Prisma.sports_injuriesWhereInput = {};
    if (dto.status) where.status = dto.status;
    if (dto.incident_type) where.incident_type = dto.incident_type;

    try {
      const injuries = await this.prisma.sports_injuries.findMany({
        where,
        include: INJURY_INCLUDE,
        orderBy: { incident_date: 'desc' },
      });
      return injuries.map(toInjuryResponse);
    } catch (err) {
      this.logger.error('DB error while fetching injuries', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/injuries/:id
   *
   * Error cases:
   *  404 INJURY_NOT_FOUND – no injury/incident with the given id
   */
  async findOne(id: number) {
    const injury = await this.findById(id);
    if (!injury) {
      throw new NotFoundException({
        message: 'Injury record not found',
        errorCode: 'INJURY_NOT_FOUND',
      });
    }
    return toInjuryResponse(injury);
  }

  /**
   * PATCH /sports-admin/injuries/:id
   *
   * Error cases:
   *  404 INJURY_NOT_FOUND – no injury/incident with the given id
   *  400 INJURY_STUDENT_REQUIRED – incident_type is 'injury' but no student_id
   *  400 INCIDENT_FACILITY_REQUIRED – incident_type is 'facility' but no facility_id
   */
  async update(id: number, dto: UpdateInjuryDto) {
    const injury = await this.findById(id);
    if (!injury) {
      throw new NotFoundException({
        message: 'Injury record not found',
        errorCode: 'INJURY_NOT_FOUND',
      });
    }

    const incidentType = dto.incident_type ?? injury.incident_type;
    const studentId =
      dto.student_id !== undefined ? dto.student_id : injury.student_id;
    const facilityId =
      dto.facility_id !== undefined ? dto.facility_id : injury.facility_id;
    this.assertSubject(incidentType, studentId ?? undefined, facilityId ?? undefined);

    try {
      const updated = await this.prisma.sports_injuries.update({
        where: { id },
        data: {
          incident_type: dto.incident_type,
          student_id: dto.student_id,
          facility_id: dto.facility_id,
          discipline_id: dto.discipline_id,
          incident: dto.incident,
          incident_date: dto.incident_date
            ? new Date(dto.incident_date)
            : undefined,
          care_notes: dto.care_notes,
          status: dto.status,
          return_to_play_date: dto.return_to_play_date
            ? new Date(dto.return_to_play_date)
            : undefined,
          medical_visit_id: dto.medical_visit_id,
        },
        include: INJURY_INCLUDE,
      });
      return toInjuryResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating injury', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/injuries/:id
   *
   * Error cases:
   *  404 INJURY_NOT_FOUND – no injury/incident with the given id
   */
  async remove(id: number) {
    const injury = await this.findById(id);
    if (!injury) {
      throw new NotFoundException({
        message: 'Injury record not found',
        errorCode: 'INJURY_NOT_FOUND',
      });
    }

    try {
      await this.prisma.sports_injuries.delete({ where: { id } });
      return { message: 'Injury record deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting injury', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private assertSubject(
    incidentType: string,
    studentId?: number,
    facilityId?: number,
  ) {
    if (incidentType === 'injury' && !studentId) {
      throw new BadRequestException({
        message: 'student_id is required for an injury incident',
        errorCode: 'INJURY_STUDENT_REQUIRED',
      });
    }
    if (incidentType === 'facility' && !facilityId) {
      throw new BadRequestException({
        message: 'facility_id is required for a facility incident',
        errorCode: 'INCIDENT_FACILITY_REQUIRED',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.sports_injuries.findUnique({
        where: { id },
        include: INJURY_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during injury lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
