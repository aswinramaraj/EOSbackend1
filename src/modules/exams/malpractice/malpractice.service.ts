import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { CreateMalpracticeIncidentDto } from './dto/create-malpractice-incident.dto';
import { UpdateMalpracticeIncidentDto } from './dto/update-malpractice-incident.dto';
import { FindMalpracticeQueryDto } from './dto/find-malpractice-query.dto';

const INCIDENT_INCLUDE = {
  students: {
    select: { id: true, student_id_no: true, roll_no: true, register_no: true },
  },
  exams: { select: { id: true, academic_year: true, semester: true } },
  exam_subject_mapping: { include: { subjects: true, classes: true } },
  venues: { select: { id: true, name: true, location: true } },
  faculty: { select: { id: true, first_name: true, last_name: true } },
} as const;

@Injectable()
export class MalpracticeService {
  private readonly logger = new Logger(MalpracticeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMalpracticeIncidentDto, recordedByUserId: number) {
    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found.',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const exam = await this.prisma.exams.findUnique({
      where: { id: dto.exam_id },
    });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    if (dto.exam_subject_mapping_id !== undefined) {
      const mapping = await this.prisma.exam_subject_mapping.findUnique({
        where: { id: dto.exam_subject_mapping_id },
      });
      if (!mapping) {
        throw new NotFoundException({
          message: 'Exam subject mapping not found.',
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
          message: 'Venue not found.',
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
          message: 'Faculty not found.',
          errorCode: 'FACULTY_NOT_FOUND',
        });
      }
    }

    try {
      return await this.prisma.malpractice_incidents.create({
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
        include: INCIDENT_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error while creating malpractice incident', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll(query: FindMalpracticeQueryDto) {
    const where = {
      student_id: query.student_id,
      exam_id: query.exam_id,
      nature: query.nature,
      action_taken: query.action_taken,
      incident_date:
        query.date_from || query.date_to
          ? {
              gte: query.date_from ? new Date(query.date_from) : undefined,
              lte: query.date_to ? new Date(query.date_to) : undefined,
            }
          : undefined,
    };

    try {
      const [data, total] = await this.prisma.$transaction([
        this.prisma.malpractice_incidents.findMany({
          where,
          skip: query.skip,
          take: query.limit,
          orderBy: { incident_date: 'desc' },
          include: INCIDENT_INCLUDE,
        }),
        this.prisma.malpractice_incidents.count({ where }),
      ]);

      return paginate(data, total, query);
    } catch (err) {
      this.logger.error('DB error while fetching malpractice incidents', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    const incident = await this.prisma.malpractice_incidents.findUnique({
      where: { id },
      include: INCIDENT_INCLUDE,
    });
    if (!incident) {
      throw new NotFoundException({
        message: 'Malpractice incident not found.',
        errorCode: 'MALPRACTICE_INCIDENT_NOT_FOUND',
      });
    }
    return incident;
  }

  async update(id: number, dto: UpdateMalpracticeIncidentDto) {
    await this.findOne(id);

    try {
      return await this.prisma.malpractice_incidents.update({
        where: { id },
        data: {
          action_taken: dto.action_taken,
          invigilator_remarks: dto.invigilator_remarks,
        },
        include: INCIDENT_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error while updating malpractice incident', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number) {
    await this.findOne(id);

    try {
      await this.prisma.malpractice_incidents.delete({ where: { id } });
      return { id };
    } catch (err) {
      this.logger.error('DB error while deleting malpractice incident', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
