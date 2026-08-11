import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { CreateAppraisalDivisionDto } from './dto/create-appraisal-division.dto';
import { CreateAppraisalCriteriaDto } from './dto/create-appraisal-criteria.dto';
import { UpdateAppraisalCriteriaDto } from './dto/update-appraisal-criteria.dto';
import { ListAppraisalCriteriaQueryDto } from './dto/list-appraisal-criteria-query.dto';

const CRITERIA_SELECT = {
  id: true,
  division_id: true,
  criteria_name: true,
  max_score: true,
  academic_year: true,
  appraisal_divisions: { select: { id: true, name: true } },
} as const;

type CriteriaRow = {
  id: number;
  division_id: number;
  criteria_name: string;
  max_score: unknown;
  academic_year: string;
  appraisal_divisions: { id: number; name: string };
};

// Prisma's Decimal serializes to a string in JSON — convert to a number here
// so API consumers (the frontend types this as `number`) get a real number.
function toCriteriaResponse(row: CriteriaRow) {
  return { ...row, max_score: Number(row.max_score) };
}

/**
 * Criteria Library — CRUD for appraisal_criteria/appraisal_divisions.
 * Neither table had any CRUD endpoints before this (only read internally, to
 * validate criteria_id when a faculty submits an appraisal).
 */
@Injectable()
export class AppraisalCriteriaService {
  private readonly logger = new Logger(AppraisalCriteriaService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---- Divisions (categories) ----

  async createDivision(dto: CreateAppraisalDivisionDto) {
    const existing = await this.prisma.appraisal_divisions.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(
        `A division named "${dto.name}" already exists`,
      );
    }
    return this.prisma.appraisal_divisions.create({ data: dto });
  }

  async findAllDivisions() {
    return this.prisma.appraisal_divisions.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async removeDivision(id: number) {
    const division = await this.prisma.appraisal_divisions.findUnique({
      where: { id },
    });
    if (!division) {
      throw new NotFoundException('Division not found');
    }

    const criteriaCount = await this.prisma.appraisal_criteria.count({
      where: { division_id: id },
    });
    if (criteriaCount > 0) {
      throw new ConflictException(
        `Cannot delete: ${criteriaCount} criteria still reference this division`,
      );
    }

    await this.prisma.appraisal_divisions.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ---- Criteria ----

  async create(dto: CreateAppraisalCriteriaDto) {
    const division = await this.prisma.appraisal_divisions.findUnique({
      where: { id: dto.division_id },
    });
    if (!division) {
      throw new NotFoundException('Division not found');
    }

    const criteria = await this.prisma.appraisal_criteria.create({
      data: dto,
      select: CRITERIA_SELECT,
    });

    this.logger.log(`Appraisal criteria created: id=${criteria.id}`);
    return toCriteriaResponse(criteria);
  }

  async findAll(query: ListAppraisalCriteriaQueryDto) {
    const where: Record<string, unknown> = {
      division_id: query.division_id,
      academic_year: query.academic_year,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.appraisal_criteria.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { id: 'desc' },
        select: CRITERIA_SELECT,
      }),
      this.prisma.appraisal_criteria.count({ where }),
    ]);

    return paginate(rows.map(toCriteriaResponse), total, query);
  }

  async findOne(id: number) {
    const criteria = await this.prisma.appraisal_criteria.findUnique({
      where: { id },
      select: CRITERIA_SELECT,
    });
    if (!criteria) {
      throw new NotFoundException('Appraisal criteria not found');
    }
    return toCriteriaResponse(criteria);
  }

  async update(id: number, dto: UpdateAppraisalCriteriaDto) {
    const existing = await this.prisma.appraisal_criteria.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Appraisal criteria not found');
    }

    if (dto.division_id !== undefined) {
      const division = await this.prisma.appraisal_divisions.findUnique({
        where: { id: dto.division_id },
      });
      if (!division) {
        throw new NotFoundException('Division not found');
      }
    }

    const updated = await this.prisma.appraisal_criteria.update({
      where: { id },
      data: dto,
      select: CRITERIA_SELECT,
    });
    return toCriteriaResponse(updated);
  }

  async remove(id: number) {
    const existing = await this.prisma.appraisal_criteria.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Appraisal criteria not found');
    }

    const entryCount = await this.prisma.appraisal_entries.count({
      where: { criteria_id: id },
    });
    if (entryCount > 0) {
      throw new ConflictException(
        `Cannot delete: ${entryCount} appraisal entries already reference this criteria`,
      );
    }

    await this.prisma.appraisal_criteria.delete({ where: { id } });

    this.logger.log(`Appraisal criteria deleted: id=${id}`);
    return { id, deleted: true };
  }
}
