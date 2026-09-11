import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListRegulationsQueryDto } from './dto/list-regulations-query.dto';
import { CreateRegulationDto } from './dto/create-regulation.dto';
import { UpdateRegulationDto } from './dto/update-regulation.dto';
import { CloneRegulationDto } from './dto/clone-regulation.dto';

@Injectable()
export class RegulationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListRegulationsQueryDto) {
    const where: Prisma.regulationsWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.level) where.applies_to_level = query.level;
    if (query.scale) where.grading_scale = query.scale;
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { applies_to_description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.regulations.findMany({
      where,
      orderBy: { id: 'desc' },
      include: { regulation_courses: { select: { course_id: true } } },
    });
  }

  async getStats() {
    const [activeCount, phasingOutCount, draftCount, total] = await Promise.all([
      this.prisma.regulations.count({ where: { status: 'active' } }),
      this.prisma.regulations.count({ where: { status: 'phasing_out' } }),
      this.prisma.regulations.count({ where: { status: 'draft' } }),
      this.prisma.regulations.count(),
    ]);

    const programmesMapped = await this.prisma.regulation_courses.findMany({
      select: { course_id: true },
      distinct: ['course_id'],
    });

    const gradeBandsCount = await this.prisma.grade_bands.count();

    const representativeActive = await this.prisma.regulations.findFirst({
      where: { status: 'active' },
      orderBy: { updated_at: 'desc' },
    });

    return {
      total,
      active_count: activeCount,
      phasing_out_count: phasingOutCount,
      draft_count: draftCount,
      programmes_mapped: programmesMapped.length,
      grade_bands_count: gradeBandsCount,
      moderation_ceiling_marks: representativeActive?.moderation_ceiling_marks ?? null,
      moderation_ceiling_candidate_pct: representativeActive?.moderation_ceiling_candidate_pct ?? null,
    };
  }

  async findOne(id: number) {
    const regulation = await this.prisma.regulations.findUnique({
      where: { id },
      include: { regulation_courses: { include: { courses: true } } },
    });
    if (!regulation) {
      throw new NotFoundException({ message: 'Regulation not found.', errorCode: 'REGULATION_NOT_FOUND' });
    }
    return regulation;
  }

  async create(dto: CreateRegulationDto, createdByUserId: number) {
    const existing = await this.prisma.regulations.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException({ message: 'A regulation with this code already exists.', errorCode: 'REGULATION_CODE_EXISTS' });
    }

    return this.prisma.regulations.create({
      data: {
        code: dto.code,
        applies_to_level: dto.applies_to_level,
        applies_to_description: dto.applies_to_description,
        intake_start_year: dto.intake_start_year,
        intake_end_year: dto.intake_end_year,
        grading_scale: dto.grading_scale ?? '10-point',
        pass_aggregate_pct: dto.pass_aggregate_pct,
        pass_external_pct: dto.pass_external_pct,
        attendance_threshold_pct: dto.attendance_threshold_pct ?? 75.0,
        moderation_ceiling_marks: dto.moderation_ceiling_marks ?? 3,
        moderation_ceiling_candidate_pct: dto.moderation_ceiling_candidate_pct ?? 5.0,
        status: dto.status ?? 'draft',
        created_by_user_id: createdByUserId,
      },
    });
  }

  async update(id: number, dto: UpdateRegulationDto) {
    await this.findOne(id);

    if (dto.code !== undefined) {
      const codeOwner = await this.prisma.regulations.findUnique({ where: { code: dto.code } });
      if (codeOwner && codeOwner.id !== id) {
        throw new ConflictException({ message: 'A regulation with this code already exists.', errorCode: 'REGULATION_CODE_EXISTS' });
      }
    }

    return this.prisma.regulations.update({
      where: { id },
      data: { ...dto, updated_at: new Date() },
    });
  }

  /** "Clone" button — Active/Phasing out rows copy their full rule set into a new draft under a new code. */
  async clone(id: number, dto: CloneRegulationDto, createdByUserId: number) {
    const source = await this.findOne(id);

    const existing = await this.prisma.regulations.findUnique({ where: { code: dto.new_code } });
    if (existing) {
      throw new ConflictException({ message: 'A regulation with this code already exists.', errorCode: 'REGULATION_CODE_EXISTS' });
    }

    return this.prisma.regulations.create({
      data: {
        code: dto.new_code,
        applies_to_level: source.applies_to_level,
        applies_to_description: source.applies_to_description,
        intake_start_year: source.intake_start_year,
        intake_end_year: source.intake_end_year,
        grading_scale: source.grading_scale,
        pass_aggregate_pct: source.pass_aggregate_pct,
        pass_external_pct: source.pass_external_pct,
        attendance_threshold_pct: source.attendance_threshold_pct,
        moderation_ceiling_marks: source.moderation_ceiling_marks,
        moderation_ceiling_candidate_pct: source.moderation_ceiling_candidate_pct,
        status: 'draft',
        created_by_user_id: createdByUserId,
      },
    });
  }

  /** "Submit" button — a draft can only move to active once its pass criteria are actually set. */
  async submit(id: number) {
    const regulation = await this.findOne(id);
    if (regulation.status !== 'draft') {
      throw new BadRequestException({ message: 'Only a draft regulation can be submitted.', errorCode: 'NOT_A_DRAFT' });
    }
    if (regulation.pass_aggregate_pct == null || regulation.pass_external_pct == null) {
      throw new BadRequestException({
        message: 'Set the pass aggregate and external percentages before submitting.',
        errorCode: 'PASS_CRITERIA_INCOMPLETE',
      });
    }

    return this.prisma.regulations.update({
      where: { id },
      data: { status: 'active', updated_at: new Date() },
    });
  }

  async mapCourse(id: number, courseId: number) {
    await this.findOne(id);
    const course = await this.prisma.courses.findUnique({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException({ message: 'Course not found.', errorCode: 'COURSE_NOT_FOUND' });
    }

    return this.prisma.regulation_courses.upsert({
      where: { regulation_id_course_id: { regulation_id: id, course_id: courseId } },
      create: { regulation_id: id, course_id: courseId },
      update: {},
    });
  }

  async unmapCourse(id: number, courseId: number) {
    await this.prisma.regulation_courses.deleteMany({ where: { regulation_id: id, course_id: courseId } });
    return { id, courseId };
  }
}
